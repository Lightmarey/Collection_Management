type ReaderAnnotation = {
  id: string;
  body?: string;
  color?: string;
  status: string;
  resolvedStart: number | null;
  resolvedEnd: number | null;
};

export function annotateReaderHtml(
  html: string,
  annotations?: { highlights?: ReaderAnnotation[]; notes?: ReaderAnnotation[] },
  document?: Document,
): string;
