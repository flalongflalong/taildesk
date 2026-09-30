declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(
      target: HTMLElement,
      url: string | WebSocket,
      options?: { credentials?: Record<string, string> },
    );
    scaleViewport: boolean;
    clipViewport: boolean;
    dragViewport: boolean;
    viewOnly: boolean;
    resizeSession: boolean;
    qualityLevel: number;
    compressionLevel: number;
    focusOnClick: boolean;
    disconnect(): void;
    focus(): void;
    blur(): void;
    sendCredentials(credentials: Record<string, string>): void;
    sendKey(keysym: number, code?: string, down?: boolean): void;
    clipboardPasteFrom(text: string): void;
    sendCtrlAltDel(): void;
    approveServer(): void;
  }
}
