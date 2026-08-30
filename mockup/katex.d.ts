export {};

declare global {
  function renderMathInElement(
    el: HTMLElement,
    opts: {
      delimiters: { left: string; right: string; display: boolean }[];
      throwOnError: boolean;
    }
  ): void;
}
