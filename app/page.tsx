'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type PointerEvent } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist/types/src/display/api';
import pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { DEFAULT_CROP, deriveProblems, type CropPreset, type Marker, type MarkerType } from '@/lib/problembook';

type Step = 1 | 2 | 3 | 4;
type FileMeta = { name: string; size: number; lastModified: number };
type CropKey = keyof CropPreset;

const STEPS = [
  ['원본 PDF', '파일 불러오기'],
  ['페이지 설정', '범위와 단 나누기'],
  ['문제 자르기', '시작과 끝 표시'],
  ['문제집 만들기', '풀이 공간과 출력'],
] as const;

const markerLabels: Record<MarkerType, { short: string; label: string; help: string }> = {
  start: { short: 'S', label: 'Start', help: '새 문제의 시작' },
  continue: { short: 'C', label: 'Continue', help: '다음 단으로 계속' },
  end: { short: 'E', label: 'End', help: '현재 문제의 끝' },
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

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const configInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>(1);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null);
  const [fileMeta, setFileMeta] = useState<FileMeta | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [oddCrop, setOddCrop] = useState<CropPreset>({ ...DEFAULT_CROP });
  const [evenCrop, setEvenCrop] = useState<CropPreset>({ ...DEFAULT_CROP });
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [markerType, setMarkerType] = useState<MarkerType>('start');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [answerSpaceMm, setAnswerSpaceMm] = useState(35);
  const [ruled, setRuled] = useState(true);
  const [appendixStart, setAppendixStart] = useState('');
  const [appendixEnd, setAppendixEnd] = useState('');
  const [status, setStatus] = useState('PDF를 선택하면 바로 시작할 수 있어요.');
  const [busy, setBusy] = useState(false);

  const pageCount = pdfDoc?.numPages ?? 0;
  const activeCrop = currentPage % 2 === 1 ? oddCrop : evenCrop;
  const cropForPage = useCallback((page: number) => page % 2 === 1 ? oddCrop : evenCrop, [oddCrop, evenCrop]);
  const result = useMemo(
    () => deriveProblems(markers, pageCount, cropForPage),
    [markers, pageCount, cropForPage],
  );
  const currentMarkers = useMemo(
    () => markers.filter((marker) => marker.page === currentPage).sort((a, b) => a.y - b.y),
    [markers, currentPage],
  );

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
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
      const document = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      await pdfDoc?.destroy();
      setPdfDoc(document);
      setSourceBytes(bytes);
      setFileMeta({ name: file.name, size: file.size, lastModified: file.lastModified });
      setCurrentPage(1);
      setMarkers([]);
      setStep(2);
      setStatus(`${document.numPages}쪽 PDF를 불러왔습니다.`);
    } catch {
      setStatus('PDF를 열 수 없습니다. 암호 설정이나 파일 손상 여부를 확인해 주세요.');
    } finally { setBusy(false); }
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    void openPdf(event.dataTransfer.files[0]);
  }

  function updateCrop(parity: 'odd' | 'even', key: CropKey, value: number) {
    const setter = parity === 'odd' ? setOddCrop : setEvenCrop;
    setter((previous) => ({ ...previous, [key]: value }));
  }

  function pagePointer(event: PointerEvent<HTMLDivElement>) {
    if (step !== 3 || draggingId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const leftStart = activeCrop.left / 100;
    const rightEnd = 1 - activeCrop.right / 100;
    if (x < leftStart || x > rightEnd) {
      setStatus('회색 여백 안쪽을 눌러 주세요.');
      return;
    }
    const column = x < activeCrop.divider / 100 ? 'left' : 'right';
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    setMarkers((previous) => [...previous, { id, page: currentPage, column, y, type: markerType }]);
    setStatus(`${currentPage}쪽 ${column === 'left' ? '왼쪽' : '오른쪽'} 단에 ${markerLabels[markerType].label}를 추가했습니다.`);
  }

  function dragMarker(event: PointerEvent<HTMLDivElement>) {
    if (!draggingId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const y = Math.min(0.995, Math.max(0.005, (event.clientY - rect.top) / rect.height));
    setMarkers((previous) => previous.map((marker) => marker.id === draggingId ? { ...marker, y } : marker));
  }

  function removeMarker(id: string) {
    setMarkers((previous) => previous.filter((marker) => marker.id !== id));
  }

  function saveConfig() {
    if (!fileMeta) return;
    const config = {
      version: 1,
      source: fileMeta,
      oddCrop,
      evenCrop,
      markers,
      output: { answerSpaceMm, ruled, appendixStart, appendixEnd },
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
      if (config.version !== 1 || !Array.isArray(config.markers)) throw new Error('invalid');
      if (config.source?.name !== fileMeta.name || config.source?.size !== fileMeta.size) {
        setStatus('다른 PDF에서 저장한 설정이라 불러오지 않았습니다.');
        return;
      }
      setOddCrop(config.oddCrop ?? DEFAULT_CROP);
      setEvenCrop(config.evenCrop ?? DEFAULT_CROP);
      setMarkers(config.markers);
      setAnswerSpaceMm(config.output?.answerSpaceMm ?? 35);
      setRuled(config.output?.ruled ?? true);
      setAppendixStart(config.output?.appendixStart ?? '');
      setAppendixEnd(config.output?.appendixEnd ?? '');
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
      const bytes = await generateProblembook({
        source: sourceBytes.slice(),
        problems: result.problems,
        cropForPage,
        answerSpaceMm,
        ruled,
        appendixStart: appendixStart ? Number(appendixStart) : undefined,
        appendixEnd: appendixEnd ? Number(appendixEnd) : undefined,
        title: `${fileMeta.name.replace(/\.pdf$/i, '')} 문제집`,
      });
      download(bytes.buffer as ArrayBuffer, `${fileMeta.name.replace(/\.pdf$/i, '')}-문제집.pdf`, 'application/pdf');
      setStatus(`${result.problems.length}개 문제로 PDF를 만들었습니다.`);
    } catch {
      setStatus('PDF 생성에 실패했습니다. 원본 PDF의 보안 설정을 확인해 주세요.');
    } finally { setBusy(false); }
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
          <nav aria-label="작업 단계">
            {STEPS.map(([label, description], index) => {
              const number = (index + 1) as Step;
              return (
                <button key={label} className={`step ${step === number ? 'is-active' : ''} ${fileMeta ? '' : 'is-locked'}`} disabled={!fileMeta && number > 1} onClick={() => setStep(number)}>
                  <b>{number}</b><span>{label}<small>{description}</small></span>
                </button>
              );
            })}
          </nav>
          {fileMeta && <div className="sidebar-actions">
            <button className="text-button" onClick={saveConfig}>작업 저장</button>
            <button className="text-button" onClick={() => configInputRef.current?.click()}>작업 불러오기</button>
            <input ref={configInputRef} type="file" accept="application/json,.json" hidden onChange={loadConfig} />
          </div>}
        </aside>

        <section className="stage">
          {step === 1 && (
            <>
              <StageTitle eyebrow="STEP 1" title="자를 PDF를 불러오세요" aside="준비됨" />
              <label className={`dropzone ${busy ? 'is-busy' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
                <input ref={pdfInputRef} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => void openPdf(event.target.files?.[0])} />
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
              <StageTitle eyebrow="STEP 2" title="두 단의 여백을 맞추세요" aside={`${currentPage} / ${pageCount}쪽`} />
              <PageNavigator current={currentPage} count={pageCount} onChange={setCurrentPage} />
              <div className="editor-layout">
                <PdfPreview canvasRef={canvasRef} crop={activeCrop} markers={[]} interactive={false} />
                <div className="control-card">
                  <div className="segmented"><span className={currentPage % 2 ? 'on' : ''}>홀수 쪽</span><span className={currentPage % 2 ? '' : 'on'}>짝수 쪽</span></div>
                  <p>현재 쪽과 같은 홀짝 페이지에 공통으로 적용됩니다.</p>
                  {(['left', 'divider', 'right', 'top', 'bottom'] as CropKey[]).map((key) => (
                    <CropSlider key={key} name={{ left: '왼쪽 여백', divider: '중앙 분할선', right: '오른쪽 여백', top: '위 여백', bottom: '아래 여백' }[key]} value={activeCrop[key]} min={key === 'divider' ? 30 : 0} max={key === 'divider' ? 70 : 20} onChange={(value) => updateCrop(currentPage % 2 ? 'odd' : 'even', key, value)} />
                  ))}
                  <button className="primary-button" onClick={() => setStep(3)}>경계 표시하러 가기</button>
                </div>
              </div>
            </>
          )}

          {step === 3 && fileMeta && (
            <>
              <StageTitle eyebrow="STEP 3" title="문제의 시작과 끝을 표시하세요" aside={`${result.problems.length}개 문제`} />
              <div className="tool-row">
                {(Object.keys(markerLabels) as MarkerType[]).map((type) => <button key={type} className={`marker-tool ${markerType === type ? 'is-selected' : ''}`} data-type={type} onClick={() => setMarkerType(type)}><b>{markerLabels[type].short}</b><span>{markerLabels[type].label}<small>{markerLabels[type].help}</small></span></button>)}
              </div>
              <PageNavigator current={currentPage} count={pageCount} onChange={setCurrentPage} />
              <div className="editor-layout wide-preview">
                <PdfPreview canvasRef={canvasRef} crop={activeCrop} markers={currentMarkers} interactive onPointer={pagePointer} onPointerMove={dragMarker} onPointerUp={() => setDraggingId(null)} onMarkerDown={(id) => setDraggingId(id)} />
                <div className="control-card marker-list-card">
                  <h3>{currentPage}쪽 경계 <span>{currentMarkers.length}</span></h3>
                  <p>PDF 위를 눌러 선을 추가하고, 선을 드래그해 위치를 조절하세요.</p>
                  <div className="marker-list">
                    {currentMarkers.length === 0 && <div className="empty-small">아직 표시한 경계가 없습니다.</div>}
                    {currentMarkers.map((marker) => <div key={marker.id} className="marker-item" data-type={marker.type}><b>{markerLabels[marker.type].short}</b><span>{marker.column === 'left' ? '왼쪽' : '오른쪽'} 단 · {(marker.y * 100).toFixed(1)}%</span><button aria-label="경계 삭제" onClick={() => removeMarker(marker.id)}>×</button></div>)}
                  </div>
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
                  <div className="paper-preview"><div className="paper-column">{result.problems.slice(0, 4).map((problem) => <span key={problem.id} style={{ height: `${Math.min(30, 8 + problem.fragments.length * 5)}%` }}><b>{problem.id}</b></span>)}</div><div className="paper-column">{result.problems.slice(4, 8).map((problem) => <span key={problem.id} style={{ height: `${Math.min(30, 8 + problem.fragments.length * 5)}%` }}><b>{problem.id}</b></span>)}</div></div>
                  <p>실제 PDF의 문제 크기에 따라 자동으로 오른쪽 단 또는 다음 쪽으로 이동합니다.</p>
                </div>
                <div className="output-controls">
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
          <h2>{step === 1 ? <>원본은 그대로,<br />필요한 문제만.</> : step === 2 ? <>회색 영역을<br />본문 밖으로.</> : step === 3 ? <>S로 시작하고<br />E로 끝내세요.</> : <>완성된 파일은<br />내 컴퓨터로.</>}</h2>
          <p>{step === 1 ? '페이지를 불러온 뒤 여백과 중앙선을 맞추고 문제의 시작과 끝을 표시하세요.' : step === 2 ? '홀수 쪽과 짝수 쪽의 제본 여백이 다르면 각각 한 번씩 맞춰 주세요.' : step === 3 ? '여러 단에 걸친 문제는 C로 조각을 닫으면 다음 단 맨 위부터 이어집니다.' : '문제와 풀이 공간은 한 덩어리로 배치되어 단 사이에서 잘리지 않습니다.'}</p>
          <div className="tip"><b>현재 상태</b><span>{status}</span></div>
          {fileMeta && step > 1 && <button className="replace-button" onClick={() => pdfInputRef.current?.click()}>다른 PDF 열기</button>}
          <input ref={pdfInputRef} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => void openPdf(event.target.files?.[0])} />
        </aside>
      </section>
    </main>
  );
}

function StageTitle({ eyebrow, title, aside }: { eyebrow: string; title: string; aside: string }) {
  return <div className="stage-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1></div><span className="page-counter">{aside}</span></div>;
}

function Feature({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return <article><b>{number}</b><strong>{title}</strong><span>{children}</span></article>;
}

function PageNavigator({ current, count, onChange }: { current: number; count: number; onChange: (page: number) => void }) {
  return <div className="page-nav"><button disabled={current <= 1} onClick={() => onChange(current - 1)}>← 이전</button><label><span>페이지</span><input type="number" min="1" max={count} value={current} onChange={(event) => onChange(Math.min(count, Math.max(1, Number(event.target.value))))} /><b>/ {count}</b></label><button disabled={current >= count} onClick={() => onChange(current + 1)}>다음 →</button></div>;
}

function CropSlider({ name, value, min, max, onChange }: { name: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label className="crop-slider"><span>{name}<output>{value}%</output></span><input type="range" min={min} max={max} step="0.5" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

interface PreviewProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  crop: CropPreset;
  markers: Marker[];
  interactive: boolean;
  onPointer?: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove?: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp?: () => void;
  onMarkerDown?: (id: string) => void;
}

function PdfPreview({ canvasRef, crop, markers, interactive, onPointer, onPointerMove, onPointerUp, onMarkerDown }: PreviewProps) {
  return <div className="preview-shell"><div className={`page-canvas-wrap ${interactive ? 'is-interactive' : ''}`} onPointerDown={onPointer} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
    <canvas ref={canvasRef} />
    <span className="shade left" style={{ width: `${crop.left}%` }} /><span className="shade right" style={{ width: `${crop.right}%` }} /><span className="shade top" style={{ top: 0, left: `${crop.left}%`, right: `${crop.right}%`, height: `${crop.top}%` }} /><span className="shade bottom" style={{ bottom: 0, left: `${crop.left}%`, right: `${crop.right}%`, height: `${crop.bottom}%` }} />
    <span className="guide divider" style={{ left: `${crop.divider}%` }} />
    {markers.map((marker) => {
      const left = marker.column === 'left' ? crop.left : crop.divider;
      const right = marker.column === 'left' ? 100 - crop.divider : crop.right;
      return <button key={marker.id} className="marker-line" data-type={marker.type} style={{ top: `${marker.y * 100}%`, left: `${left}%`, right: `${right}%` }} onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); onMarkerDown?.(marker.id); }} onClick={(event) => event.stopPropagation()}><b>{markerLabels[marker.type].short}</b></button>;
    })}
  </div></div>;
}
