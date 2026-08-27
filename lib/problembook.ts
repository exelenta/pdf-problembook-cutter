export type Column = 'left' | 'right';
export type MarkerType = 'start' | 'continue' | 'end';

export interface CropPreset {
  left: number;
  divider: number;
  right: number;
}

export interface Marker {
  id: string;
  page: number;
  column: Column;
  y: number;
  type: MarkerType;
}

export interface Fragment {
  page: number;
  column: Column;
  yStart: number;
  yEnd: number;
}

export interface Problem {
  id: number;
  fragments: Fragment[];
}

export interface DeriveResult {
  problems: Problem[];
  warnings: string[];
}

export const DEFAULT_CROP: CropPreset = {
  left: 5,
  divider: 50,
  right: 5,
};

const cellKey = (page: number, column: Column) => `${page}:${column}`;

export function deriveProblems(
  markers: Marker[],
  pageCount: number,
): DeriveResult {
  const byCell = new Map<string, Marker[]>();
  for (const marker of markers) {
    const list = byCell.get(cellKey(marker.page, marker.column)) ?? [];
    list.push(marker);
    byCell.set(cellKey(marker.page, marker.column), list);
  }
  for (const list of byCell.values()) list.sort((a, b) => a.y - b.y);

  const problems: Problem[] = [];
  const warnings: string[] = [];
  let open: Fragment[] | null = null;
  let problemId = 1;
  let resumesAtNextCell = false;

  const pushFragment = (page: number, column: Column, start: number, end: number) => {
    if (!open || end - start < 0.002) return;
    open.push({ page, column, yStart: start, yEnd: end });
  };

  for (let page = 1; page <= pageCount; page += 1) {
    const top = 0;
    const bottom = 1;
    for (const column of ['left', 'right'] as const) {
      const list = byCell.get(cellKey(page, column)) ?? [];
      let cursor: number | null = open && resumesAtNextCell ? top : null;
      resumesAtNextCell = false;

      for (const marker of list) {
        const y = Math.min(bottom, Math.max(top, marker.y));
        if (marker.type === 'start') {
          if (open) {
            if (cursor !== null) pushFragment(page, column, cursor, y);
            if (open.length) problems.push({ id: problemId++, fragments: open });
          }
          open = [];
          cursor = y;
        } else if (marker.type === 'continue') {
          if (!open) {
            warnings.push(`${page}쪽 ${column === 'left' ? '왼쪽' : '오른쪽'} 단의 Continue 앞에 Start가 없습니다.`);
            continue;
          }
          pushFragment(page, column, cursor ?? top, y);
          cursor = null;
          resumesAtNextCell = true;
        } else {
          if (!open) {
            warnings.push(`${page}쪽 ${column === 'left' ? '왼쪽' : '오른쪽'} 단의 End 앞에 Start가 없습니다.`);
            continue;
          }
          pushFragment(page, column, cursor ?? top, y);
          if (open.length) problems.push({ id: problemId++, fragments: open });
          open = null;
          cursor = null;
          resumesAtNextCell = false;
        }
      }

      if (open && cursor !== null) {
        pushFragment(page, column, cursor, bottom);
        resumesAtNextCell = true;
      }
    }
  }

  if (open) warnings.push('마지막 Start가 End로 닫히지 않았습니다. 미완성 문제는 출력에서 제외됩니다.');
  return { problems, warnings };
}

export function cropXRange(column: Column, preset: CropPreset) {
  return column === 'left'
    ? { start: preset.left / 100, end: preset.divider / 100 }
    : { start: preset.divider / 100, end: 1 - preset.right / 100 };
}
