'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type PointerEvent } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist/types/src/display/api';
import { DEFAULT_CROP, deriveProblems, type CropPreset, type Marker, type MarkerType } from '@/lib/problembook';
import { getShortcutAction } from '@/lib/shortcuts';

type Step = 1 | 2 | 3 | 4;
type FileMeta = { name: string; size: number; lastModified: number };
type CropKey = keyof CropPreset;
type EditMode = MarkerType | 'delete';
type OutlineEntry = { title: string; page: number; level: number };
type EditSnapshot = { markers: Marker[]; oddCrop: CropPreset; evenCrop: CropPreset };

const STEPS = [
  ['원본 PDF', '파일 불러오기'],
  ['페이지 설정', '범위와 단 나누기'],
  ['문제 자르기', '시작과 끝 표시'],
  ['문제집 만들기', '풀이 공간과 출력'],
] as const;

const markerLabels: Record<MarkerType, { short: string; label: string; help: string; key: string }> = {
  start: { short: 'S', label: 'Start', help: '새 문제의 시작', key: 'S' },
  continue: { short: 'C', label: 'Continue', help: '다음 단으로 계속', key: 'C' },
  end: { short: 'E', label: 'End', help: '현재 문제의 끝', key: 'E' },
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function download(data: BlobPart, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function sanitizeCrop(value?: Partial<CropPreset>): CropPreset {
  const left = Number(value?.left ?? DEFAULT_CROP.left);
  const right = Number(value?.right ?? DEFAULT_CROP.right);
  const divider = Number(value?.divider ?? DEFAULT_CROP.divider);
  return {
    left: Math.max(0, Math.min(40, left)),
    divider: Math.max(left + 5, Math.min(100 - right - 5, divider)),
    right: Math.max(0, Math.min(40, right)),
  };
}

async function extractOutline(document: PDFDocumentProxy): Promise<OutlineEntry[]> {
  const root = await document.getOutline();
  if (!root?.length) return [];
  const entries: OutlineEntry[] = [];

  async function visit(items: typeof root, level: number) {
    for (const item of items) {
      try {
        const destination = typeof item.dest === 'string' ? await document.getDestination(item.dest) : item.dest;
        if (Array.isArray(destination) && destination[0]) {
          const page = await document.getPageIndex(destination[0]) + 1;
          entries.push({ title: item.title.trim() || `페이지 ${page}`, page, level });
        }
      } catch {
        // 손상된 개별 목차 항목은 건너뛰고 나머지 목차를 계속 읽습니다.
      }
      if (item.items?.length) await visit(item.items, level + 1);
    }
  }

  await visit(root, 0);
  return entries;
}

async function renderTitlePng(title: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 140;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable');
  let fontSize = 72;
  context.font = `700 ${fontSize}px Arial, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
  const measured = context.measureText(title).width;
  if (measured > 1540) fontSize = Math.max(34, fontSize * 1540 / measured);
  context.font = `700 ${fontSize}px Arial, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
  context.fillStyle = '#17211b';
  context.textBaseline = 'middle';
  context.fillText(title, 12, 72);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('PNG encoding failed')), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const configInputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<EditSnapshot[]>([]);
  const [historySize, setHistorySize] = useState(0);
  const [step, setStep] = useState<Step>(1);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null);
  const [fileMeta, setFileMeta] = useState<FileMeta | null>(null);
  const [outline, setOutline] = useState<OutlineEntry[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [oddCrop, setOddCrop] = useState<CropPreset>({ ...DEFAULT_CROP });
  const [evenCrop, setEvenCrop] = useState<CropPreset>({ ...DEFAULT_CROP });
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [editMode, setEditMode] = useState<EditMode>('start');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingCrop, setDraggingCrop] = useState<CropKey | null>(null);
  const [answerSpaceMm, setAnswerSpaceMm] = useState(35);
  const [ruled, setRuled] = useState(true);
  const [includeTitle, setIncludeTitle] = useState(false);
  const [titleText, setTitleText] = useState('');
  const [includeProblemNumbers, setIncludeProblemNumbers] = useState(true);
  const [appendixStart, setAppendixStart] = useState('');
  const [appendixEnd, setAppendixEnd] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [status, setStatus] = useState('PDF를 선택하면 바로 시작할 수 있어요.');
  const [busy, setBusy] = useState(false);

  const pageCount = pdfDoc?.numPages ?? 0;
  const activeCrop = currentPage % 2 === 1 ? oddCrop : evenCrop;
  const cropForPage = useCallback((page: number) => page % 2 === 1 ? oddCrop : evenCrop, [oddCrop, evenCrop]);
  const result = useMemo(() => deriveProblems(markers, pageCount), [markers, pageCount]);
  const currentMarkers = useMemo(() => markers.filter((marker) => marker.page === currentPage).sort((a, b) => a.y - b.y), [markers, currentPage]);

  function captureHistory() {
    historyRef.current = [...historyRef.current.slice(-49), {
      markers: markers.map((marker) => ({ ...marker })),
      oddCrop: { ...oddCrop },
      evenCrop: { ...evenCrop },
    }];
    setHistorySize(historyRef.current.length);
  }

  const undoLast = useCallback(() => {
    const snapshot = historyRef.current.pop();
    if (!snapshot) return;
    setMarkers(snapshot.markers);
    setOddCrop(snapshot.oddCrop);
    setEvenCrop(snapshot.evenCrop);
    setHistorySize(historyRef.current.length);
    setStatus('마지막 편집을 실행취소했습니다.');
  }, []);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;
    const render = async () => {
      renderTaskRef.current?.cancel();
      const page = await pdfDoc.getPage(currentPage);
      if (cancelled || !canvasRef.current) return;
      const viewport = page.getViewport({ scale: 1.55 });
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const task = page.render({ canvas, canvasContext: context, viewport });
      renderTaskRef.current = task;
      try { await task.promise; } catch (error) {
        if (error instanceof Error && error.name !== 'RenderingCancelledException') setStatus('페이지를 그리지 못했습니다.');
      }
    };
    void render();
    return () => { cancelled = true; renderTaskRef.current?.cancel(); };
  }, [pdfDoc, currentPage]);

  useEffect(() => {
    if (step !== 3) return;
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const action = getShortcutAction({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        editable: Boolean(target?.matches('input, textarea, select, [contenteditable="true"]')),
      });
      if (!action) return;
      if (action === 'undo') {
        event.preventDefault();
        undoLast();
      } else if (action === 'start' || action === 'continue' || action === 'end') {
        event.preventDefault();
        setEditMode(action);
      } else if (action === 'delete') {
        event.preventDefault();
        setEditMode('delete');
      } else if (action === 'previous-page') {
        event.preventDefault();
        setCurrentPage((page) => Math.max(1, page - 1));
      } else if (action === 'next-page') {
        event.preventDefault();
        setCurrentPage((page) => Math.min(pageCount, page + 1));
      } else if (action === 'cancel') {
        setEditMode('start');
        setDraggingId(null);
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [pageCount, step, undoLast]);

  async function openPdf(file?: File) {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setStatus('PDF 파일만 선택할 수 있습니다.');
      return;
    }
    setBusy(true);
    setStatus('PDF를 읽고 있습니다…');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString();
      const document = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      const entries = await extractOutline(document);
      await pdfDoc?.destroy();
      setPdfDoc(document);
      setSourceBytes(bytes);
      setFileMeta({ name: file.name, size: file.size, lastModified: file.lastModified });
      setTitleText(`${file.name.replace(/\.pdf$/i, '')} 문제집`);
      setOutline(entries);
      setCurrentPage(1);
      setMarkers([]);
      historyRef.current = [];
      setHistorySize(0);
      setStep(2);
      setStatus(`${document.numPages}쪽 PDF를 불러왔습니다.${entries.length ? ` 목차 ${entries.length}개를 찾았습니다.` : ''}`);
    } catch {
      setStatus('PDF를 열 수 없습니다. 암호 설정이나 파일 손상 여부를 확인해 주세요.');
    } finally { setBusy(false); }
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    void openPdf(event.dataTransfer.files[0]);
  }

  function updateActiveCrop(key: CropKey, value: number) {
    const setter = currentPage % 2 === 1 ? setOddCrop : setEvenCrop;
    setter((previous) => sanitizeCrop({ ...previous, [key]: value }));
  }

  function beginCropDrag(key: CropKey, event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.stopPropagation();
    captureHistory();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingCrop(key);
  }

  function dragCrop(event: PointerEvent<HTMLDivElement>) {
    if (!draggingCrop) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100));
    if (draggingCrop === 'left') updateActiveCrop('left', Math.min(activeCrop.divider - 5, x));
    else if (draggingCrop === 'divider') updateActiveCrop('divider', Math.max(activeCrop.left + 5, Math.min(100 - activeCrop.right - 5, x)));
    else updateActiveCrop('right', Math.min(100 - activeCrop.divider - 5, 100 - x));
  }

  function pagePointer(event: PointerEvent<HTMLDivElement>) {
    if (step !== 3 || draggingId || editMode === 'delete') return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = Math.min(0.999, Math.max(0.001, (event.clientY - rect.top) / rect.height));
    const leftStart = activeCrop.left / 100;
    const rightEnd = 1 - activeCrop.right / 100;
    if (x < leftStart || x > rightEnd) {
      setStatus('회색 여백 안쪽을 눌러 주세요.');
      return;
    }
    captureHistory();
    const column = x < activeCrop.divider / 100 ? 'left' : 'right';
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    setMarkers((previous) => [...previous, { id, page: currentPage, column, y, type: editMode }]);
    setStatus(`${currentPage}쪽 ${column === 'left' ? '왼쪽' : '오른쪽'} 단에 ${markerLabels[editMode].label}를 추가했습니다.`);
  }

  function markerPointer(id: string, event: PointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (editMode === 'delete') {
      captureHistory();
      setMarkers((previous) => previous.filter((marker) => marker.id !== id));
      setStatus('경계선을 삭제했습니다.');
      return;
    }
    captureHistory();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingId(id);
  }

  function dragMarker(event: PointerEvent<HTMLDivElement>) {
    if (!draggingId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const y = Math.min(0.999, Math.max(0.001, (event.clientY - rect.top) / rect.height));
    setMarkers((previous) => previous.map((marker) => marker.id === draggingId ? { ...marker, y } : marker));
  }

  function saveConfig() {
    if (!fileMeta) return;
    const config = {
      version: 2,
      source: fileMeta,
      oddCrop,
      evenCrop,
      markers,
      output: { answerSpaceMm, ruled, appendixStart, appendixEnd, includeTitle, titleText, includeProblemNumbers },
    };
    download(JSON.stringify(config, null, 2), `${fileMeta.name.replace(/\.pdf$/i, '')}-작업.json`, 'application/json');
    setStatus('작업 설정을 저장했습니다.');
  }

  async function loadConfig(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !fileMeta) return;
    try {
      const config = JSON.parse(await file.text());
      if (![1, 2].includes(config.version) || !Array.isArray(config.markers)) throw new Error('invalid');
      if (config.source?.name !== fileMeta.name || config.source?.size !== fileMeta.size) {
        setStatus('다른 PDF에서 저장한 설정이라 불러오지 않았습니다.');
        return;
      }
      captureHistory();
      setOddCrop(sanitizeCrop(config.oddCrop));
      setEvenCrop(sanitizeCrop(config.evenCrop));
      setMarkers(config.markers);
      setAnswerSpaceMm(config.output?.answerSpaceMm ?? 35);
      setRuled(config.output?.ruled ?? true);
      setAppendixStart(config.output?.appendixStart ?? '');
      setAppendixEnd(config.output?.appendixEnd ?? '');
      setIncludeTitle(config.output?.includeTitle ?? false);
      setTitleText(config.output?.titleText ?? `${fileMeta.name.replace(/\.pdf$/i, '')} 문제집`);
      setIncludeProblemNumbers(config.output?.includeProblemNumbers ?? true);
      setStep(3);
      setStatus('저장된 작업을 불러왔습니다.');
    } catch { setStatus('올바른 문제집 커터 설정 파일이 아닙니다.'); }
  }

  async function makePdf() {
    if (!sourceBytes || !fileMeta || !result.problems.length) return;
    setBusy(true);
    setStatus('문제집 PDF를 만들고 있습니다…');
    try {
      const { generateProblembook } = await import('@/lib/generatePdf');
      const cleanTitle = titleText.trim() || `${fileMeta.name.replace(/\.pdf$/i, '')} 문제집`;
      const titleImage = includeTitle ? await renderTitlePng(cleanTitle) : undefined;
      const bytes = await generateProblembook({
        source: sourceBytes.slice(),
        problems: result.problems,
        cropForPage,
        answerSpaceMm,
        ruled,
        appendixStart: appendixStart ? Number(appendixStart) : undefined,
        appendixEnd: appendixEnd ? Number(appendixEnd) : undefined,
        title: cleanTitle,
        titleImage,
        showProblemNumbers: includeProblemNumbers,
      });
      download(bytes.buffer as ArrayBuffer, `${fileMeta.name.replace(/\.pdf$/i, '')}-문제집.pdf`, 'application/pdf');
      setStatus(`${result.problems.length}개 문제로 PDF를 만들었습니다.`);
    } catch {
      setStatus('PDF 생성에 실패했습니다. 원본 PDF의 보안 설정을 확인해 주세요.');
    } finally { setBusy(false); }
  }

  function chooseStep(value: Step) {
    setStep(value);
    setMobileMenuOpen(false);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">C</div>
        <div><strong>문제집 커터</strong><span>PDF를 내 학습지로</span></div>
        {fileMeta && <span className="file-chip" title={fileMeta.name}>{fileMeta.name} · {formatBytes(fileMeta.size)}</span>}
        <div className="privacy-pill">● 브라우저 안에서만 처리</div>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <StepNavigation step={step} enabled={Boolean(fileMeta)} onChoose={chooseStep} />
          {fileMeta && <div className="sidebar-actions">
            <button className="text-button" onClick={saveConfig}>작업 저장</button>
            <button className="text-button" onClick={() => configInputRef.current?.click()}>작업 불러오기</button>
          </div>}
        </aside>

        <section className="stage">
          {step === 1 && (
            <>
              <StageTitle eyebrow="STEP 1" title="자를 PDF를 불러오세요" aside="준비됨" />
              <label className={`dropzone ${busy ? 'is-busy' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
                <input type="file" accept="application/pdf,.pdf" hidden onChange={(event) => void openPdf(event.target.files?.[0])} />
                <span className="file-icon" aria-hidden="true">PDF</span>
                <strong>{busy ? 'PDF를 읽는 중…' : 'PDF 파일을 여기에 놓으세요'}</strong>
                <span>또는 눌러서 컴퓨터에서 선택</span><em>파일은 서버로 전송되지 않습니다</em>
              </label>
              <div className="feature-row">
                <Feature number="01" title="두 단 자동 작업">좌우 단을 따로 보며 문제 경계를 표시합니다.</Feature>
                <Feature number="02" title="이어지는 문제 연결">여러 페이지에 걸친 문제도 하나로 묶습니다.</Feature>
                <Feature number="03" title="A4 문제집 출력">원하는 풀이 공간을 더해 새 PDF를 만듭니다.</Feature>
              </div>
            </>
          )}

          {step === 2 && fileMeta && (
            <>
              <StageTitle eyebrow="STEP 2" title="좌·중앙·우 경계를 맞추세요" aside={`${currentPage} / ${pageCount}쪽`} />
              <OutlineNavigator entries={outline} onChoose={setCurrentPage} />
              <PageNavigator current={currentPage} count={pageCount} onChange={setCurrentPage} />
              <div className="editor-layout">
                <PdfPreview canvasRef={canvasRef} crop={activeCrop} markers={[]} mode="crop" draggingCrop={draggingCrop} onCropDown={beginCropDrag} onPointerMove={dragCrop} onPointerUp={() => setDraggingCrop(null)} />
                <div className="control-card">
                  <div className="segmented"><span className={currentPage % 2 ? 'on' : ''}>홀수 쪽</span><span className={currentPage % 2 ? '' : 'on'}>짝수 쪽</span></div>
                  <p>PDF 위의 세로선을 마우스나 터치로 끌어 조정하세요. 같은 홀짝 페이지에 공통 적용됩니다.</p>
                  {(['left', 'divider', 'right'] as CropKey[]).map((key) => (
                    <CropSlider key={key} name={{ left: '왼쪽 경계', divider: '중앙 분할선', right: '오른쪽 경계' }[key]} value={activeCrop[key]} min={key === 'divider' ? 20 : 0} max={key === 'divider' ? 80 : 40} onBegin={captureHistory} onChange={(value) => updateActiveCrop(key, value)} />
                  ))}
                  <button className="undo-button" disabled={!historySize} onClick={undoLast}>↶ 실행취소</button>
                  <button className="primary-button" onClick={() => setStep(3)}>문제 경계 표시하기</button>
                </div>
              </div>
            </>
          )}

          {step === 3 && fileMeta && (
            <>
              <StageTitle eyebrow="STEP 3" title="문제의 시작과 끝을 표시하세요" aside={`${result.problems.length}개 문제`} />
              <EditorTools mode={editMode} canUndo={Boolean(historySize)} onMode={setEditMode} onUndo={undoLast} />
              <OutlineNavigator entries={outline} onChoose={setCurrentPage} />
              <PageNavigator current={currentPage} count={pageCount} onChange={setCurrentPage} />
              <div className="editor-layout wide-preview">
                <PdfPreview canvasRef={canvasRef} crop={activeCrop} markers={currentMarkers} mode="markers" deleteMode={editMode === 'delete'} onPointer={pagePointer} onPointerMove={dragMarker} onPointerUp={() => setDraggingId(null)} onMarkerDown={markerPointer} />
                <div className="control-card marker-help-card">
                  <h3>{currentPage}쪽 <span>{currentMarkers.length}개 경계</span></h3>
                  <p>{editMode === 'delete' ? '삭제할 경계선을 PDF 위에서 직접 누르세요.' : 'PDF 위를 눌러 경계를 추가하고, 생성한 선을 끌어 위치를 조절하세요.'}</p>
                  <div className="shortcut-grid"><span><kbd>S</kbd> Start</span><span><kbd>C</kbd> Continue</span><span><kbd>E</kbd> End</span><span><kbd>X</kbd> 삭제</span><span><kbd>← →</kbd> 페이지</span><span><kbd>Ctrl Z</kbd> 실행취소</span></div>
                  {result.warnings.length > 0 && <div className="warning-box">{result.warnings.slice(0, 2).map((warning) => <span key={warning}>{warning}</span>)}</div>}
                  <button className="primary-button" disabled={!result.problems.length} onClick={() => setStep(4)}>출력 설정하기</button>
                </div>
              </div>
            </>
          )}

          {step === 4 && fileMeta && (
            <>
              <StageTitle eyebrow="STEP 4" title="나만의 문제집을 만드세요" aside={`${result.problems.length}개 문제`} />
              <div className="output-grid">
                <div className="summary-card">
                  <span className="eyebrow">OUTPUT PREVIEW</span>
                  <div className="paper-preview">{includeTitle && <strong className="preview-title">{titleText || '문제집 제목'}</strong>}<div className="paper-column">{result.problems.slice(0, 4).map((problem) => <span key={problem.id} style={{ height: `${Math.min(30, 8 + problem.fragments.length * 5)}%` }}>{includeProblemNumbers && <b>{problem.id}</b>}</span>)}</div><div className="paper-column">{result.problems.slice(4, 8).map((problem) => <span key={problem.id} style={{ height: `${Math.min(30, 8 + problem.fragments.length * 5)}%` }}>{includeProblemNumbers && <b>{problem.id}</b>}</span>)}</div></div>
                  <p>문제와 풀이 공간은 한 덩어리로 배치되어 단 사이에서 잘리지 않습니다.</p>
                </div>
                <div className="output-controls">
                  <div className="control-section"><label>출력 꾸미기 <small>선택 사항</small></label><label className="check-row"><input type="checkbox" checked={includeTitle} onChange={(event) => setIncludeTitle(event.target.checked)} /><span>첫 페이지에 제목 넣기</span></label>{includeTitle && <input className="title-field" type="text" maxLength={100} value={titleText} onChange={(event) => setTitleText(event.target.value)} placeholder="문제집 제목" />}<label className="check-row"><input type="checkbox" checked={includeProblemNumbers} onChange={(event) => setIncludeProblemNumbers(event.target.checked)} /><span>각 문제 앞에 번호 넣기</span></label></div>
                  <div className="control-section"><label>문제별 풀이 공간 <output>{answerSpaceMm} mm</output></label><input type="range" min="0" max="100" step="5" value={answerSpaceMm} onChange={(event) => setAnswerSpaceMm(Number(event.target.value))} /><label className="check-row"><input type="checkbox" checked={ruled} onChange={(event) => setRuled(event.target.checked)} /><span>풀이 공간에 옅은 줄 넣기</span></label></div>
                  <div className="control-section"><label>정답 부록 <small>선택 사항</small></label><div className="range-fields"><input type="number" min="1" max={pageCount} placeholder="시작 쪽" value={appendixStart} onChange={(event) => setAppendixStart(event.target.value)} /><span>—</span><input type="number" min="1" max={pageCount} placeholder="끝 쪽" value={appendixEnd} onChange={(event) => setAppendixEnd(event.target.value)} /></div></div>
                  <div className="output-stat"><span>문제 수<strong>{result.problems.length}</strong></span><span>원본 조각<strong>{result.problems.reduce((sum, problem) => sum + problem.fragments.length, 0)}</strong></span><span>출력 형식<strong>A4 · 2단</strong></span></div>
                  <button className="generate-button" disabled={busy || !result.problems.length} onClick={() => void makePdf()}>{busy ? 'PDF 만드는 중…' : '문제집 PDF 다운로드'}<span>브라우저에서 바로 생성됩니다</span></button>
                </div>
              </div>
            </>
          )}
        </section>

        <aside className="inspector">
          <span className="eyebrow">{step === 1 ? '작업 안내' : `STEP ${step} GUIDE`}</span>
          <h2>{step === 1 ? <>원본은 그대로,<br />필요한 문제만.</> : step === 2 ? <>세로선을 끌어<br />본문에 맞추세요.</> : step === 3 ? <>S로 시작하고<br />E로 끝내세요.</> : <>완성된 파일은<br />내 컴퓨터로.</>}</h2>
          <p>{step === 1 ? '페이지를 불러온 뒤 좌우 경계를 맞추고 문제의 시작과 끝을 표시하세요.' : step === 2 ? '홀수 쪽과 짝수 쪽의 제본 여백이 다르면 각각 한 번씩 맞춰 주세요.' : step === 3 ? '여러 단에 걸친 문제는 C로 조각을 닫으면 다음 단 맨 위부터 이어집니다.' : '제목과 문제 번호는 필요한 경우에만 선택해 넣을 수 있습니다.'}</p>
          <div className="tip"><b>현재 상태</b><span>{status}</span></div>
          {fileMeta && step > 1 && <button className="replace-button" onClick={() => pdfInputRef.current?.click()}>다른 PDF 열기</button>}
        </aside>
      </section>

      <button className="mobile-fab" aria-expanded={mobileMenuOpen} aria-controls="mobile-tools" onClick={() => setMobileMenuOpen((open) => !open)}>{mobileMenuOpen ? '닫기' : '도구'}</button>
      {mobileMenuOpen && <div className="mobile-menu" id="mobile-tools">
        <StepNavigation step={step} enabled={Boolean(fileMeta)} onChoose={chooseStep} compact />
        {step === 3 && <EditorTools mode={editMode} canUndo={Boolean(historySize)} onMode={(mode) => { setEditMode(mode); setMobileMenuOpen(false); }} onUndo={() => { undoLast(); setMobileMenuOpen(false); }} />}
        {fileMeta && <div className="mobile-file-actions"><button onClick={saveConfig}>작업 저장</button><button onClick={() => { configInputRef.current?.click(); setMobileMenuOpen(false); }}>작업 불러오기</button><button onClick={() => { pdfInputRef.current?.click(); setMobileMenuOpen(false); }}>다른 PDF</button></div>}
      </div>}
      <input ref={pdfInputRef} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => void openPdf(event.target.files?.[0])} />
      <input ref={configInputRef} type="file" accept="application/json,.json" hidden onChange={loadConfig} />
    </main>
  );
}

function StageTitle({ eyebrow, title, aside }: { eyebrow: string; title: string; aside: string }) {
  return <div className="stage-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1></div><span className="page-counter">{aside}</span></div>;
}

function Feature({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return <article><b>{number}</b><strong>{title}</strong><span>{children}</span></article>;
}

function StepNavigation({ step, enabled, onChoose, compact = false }: { step: Step; enabled: boolean; onChoose: (step: Step) => void; compact?: boolean }) {
  return <nav aria-label="작업 단계" className={compact ? 'compact-steps' : ''}>{STEPS.map(([label, description], index) => { const number = (index + 1) as Step; return <button key={label} className={`step ${step === number ? 'is-active' : ''}`} disabled={!enabled && number > 1} onClick={() => onChoose(number)}><b>{number}</b><span>{label}<small>{description}</small></span></button>; })}</nav>;
}

function PageNavigator({ current, count, onChange }: { current: number; count: number; onChange: (page: number) => void }) {
  return <div className="page-nav"><button disabled={current <= 1} onClick={() => onChange(current - 1)}>← 이전</button><label><span>페이지</span><input type="number" min="1" max={count} value={current} onChange={(event) => onChange(Math.min(count, Math.max(1, Number(event.target.value))))} /><b>/ {count}</b></label><button disabled={current >= count} onClick={() => onChange(current + 1)}>다음 →</button></div>;
}

function OutlineNavigator({ entries, onChoose }: { entries: OutlineEntry[]; onChoose: (page: number) => void }) {
  if (!entries.length) return null;
  return <details className="outline-nav"><summary>PDF 목차 <b>{entries.length}</b></summary><div>{entries.map((entry, index) => <button key={`${entry.page}-${index}`} style={{ paddingLeft: `${12 + entry.level * 14}px` }} onClick={() => { onChoose(entry.page); (document.activeElement as HTMLElement)?.blur(); }}>{entry.title}<span>{entry.page}</span></button>)}</div></details>;
}

function CropSlider({ name, value, min, max, onBegin, onChange }: { name: string; value: number; min: number; max: number; onBegin: () => void; onChange: (value: number) => void }) {
  return <label className="crop-slider"><span>{name}<output>{value.toFixed(1)}%</output></span><input type="range" min={min} max={max} step="0.5" value={value} onPointerDown={onBegin} onKeyDown={(event) => { if (event.key.startsWith('Arrow')) onBegin(); }} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function EditorTools({ mode, canUndo, onMode, onUndo }: { mode: EditMode; canUndo: boolean; onMode: (mode: EditMode) => void; onUndo: () => void }) {
  return <div className="tool-row">{(Object.keys(markerLabels) as MarkerType[]).map((type) => <button key={type} className={`marker-tool ${mode === type ? 'is-selected' : ''}`} data-type={type} onClick={() => onMode(type)}><b>{markerLabels[type].short}</b><span>{markerLabels[type].label}<small>{markerLabels[type].help} · {markerLabels[type].key}</small></span></button>)}<button className={`marker-tool delete-tool ${mode === 'delete' ? 'is-selected' : ''}`} onClick={() => onMode('delete')}><b>×</b><span>삭제<small>선을 누르면 삭제 · X</small></span></button><button className="marker-tool undo-tool" disabled={!canUndo} onClick={onUndo}><b>↶</b><span>실행취소<small>Ctrl/⌘ + Z</small></span></button></div>;
}

interface PreviewProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  crop: CropPreset;
  markers: Marker[];
  mode: 'plain' | 'crop' | 'markers';
  deleteMode?: boolean;
  draggingCrop?: CropKey | null;
  onPointer?: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove?: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp?: () => void;
  onMarkerDown?: (id: string, event: PointerEvent<HTMLButtonElement>) => void;
  onCropDown?: (key: CropKey, event: PointerEvent<HTMLButtonElement>) => void;
}

function PdfPreview({ canvasRef, crop, markers, mode, deleteMode, draggingCrop, onPointer, onPointerMove, onPointerUp, onMarkerDown, onCropDown }: PreviewProps) {
  const rightEdge = 100 - crop.right;
  return <div className="preview-shell"><div className={`page-canvas-wrap mode-${mode} ${deleteMode ? 'is-delete' : ''}`} onPointerDown={onPointer} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
    <canvas ref={canvasRef} />
    <span className="shade left" style={{ width: `${crop.left}%` }} /><span className="shade right" style={{ width: `${crop.right}%` }} />
    {mode === 'crop' ? <>
      <button className={`crop-guide left-guide ${draggingCrop === 'left' ? 'is-dragging' : ''}`} style={{ left: `${crop.left}%` }} aria-label="왼쪽 경계 조정" onPointerDown={(event) => onCropDown?.('left', event)}><b>왼쪽</b></button>
      <button className={`crop-guide divider-guide ${draggingCrop === 'divider' ? 'is-dragging' : ''}`} style={{ left: `${crop.divider}%` }} aria-label="중앙 분할선 조정" onPointerDown={(event) => onCropDown?.('divider', event)}><b>중앙</b></button>
      <button className={`crop-guide right-guide ${draggingCrop === 'right' ? 'is-dragging' : ''}`} style={{ left: `${rightEdge}%` }} aria-label="오른쪽 경계 조정" onPointerDown={(event) => onCropDown?.('right', event)}><b>오른쪽</b></button>
    </> : <span className="guide divider" style={{ left: `${crop.divider}%` }} />}
    {markers.map((marker) => {
      const left = marker.column === 'left' ? crop.left : crop.divider;
      const right = marker.column === 'left' ? 100 - crop.divider : crop.right;
      return <button key={marker.id} className="marker-line" data-type={marker.type} style={{ top: `${marker.y * 100}%`, left: `${left}%`, right: `${right}%` }} onPointerDown={(event) => onMarkerDown?.(marker.id, event)} onClick={(event) => event.stopPropagation()}><b>{markerLabels[marker.type].short}</b></button>;
    })}
  </div></div>;
}
