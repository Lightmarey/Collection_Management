export type ZhihuSignatureHeaders = Readonly<{
  'x-zse-93': string;
  'x-zse-96': string;
  'x-requested-with': string;
  'x-xsrftoken'?: string;
}>;

export function signZhihuRequest(finalUrl: string, dC0: string, xsrfToken?: string): ZhihuSignatureHeaders;
