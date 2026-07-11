import type {PipRegion} from '../pure/pipMonitor.js';
import {pipWindowSize} from '../pure/pipMonitor.js';

interface DocumentPictureInPicture {
  requestWindow(options?: {width?: number; height?: number}): Promise<Window>;
}

function documentPipEntry(): DocumentPictureInPicture | undefined {
  return (globalThis as {documentPictureInPicture?: DocumentPictureInPicture})
    .documentPictureInPicture;
}

export function isDocumentPipSupported(): boolean {
  return documentPipEntry() !== undefined;
}

export interface PipMonitorHandle {
  close(): void;
}

/**
 * gameCanvas の一部領域を常時最前面の Document PiP ウィンドウへ
 * ミラー描画する。録画対象の gameCanvas には触れず、PiP 側 canvas に
 * requestAnimationFrame で drawImage し続けるだけなので録画は無傷。
 */
export async function openMonitorPip(options: {
  sourceCanvas: HTMLCanvasElement;
  region: PipRegion;
  title: string;
  onClosed(): void;
}): Promise<PipMonitorHandle> {
  const entry = documentPipEntry();
  if (!entry) throw new Error('Document Picture-in-Picture is not supported');
  const size = pipWindowSize(options.region);
  const pipWindow = await entry.requestWindow({
    width: size.width,
    height: size.height,
  });

  const doc = pipWindow.document;
  doc.title = options.title;
  doc.body.style.margin = '0';
  doc.body.style.background = '#05070d';
  doc.body.style.display = 'grid';
  doc.body.style.placeItems = 'center';
  const mirror = doc.createElement('canvas');
  mirror.width = options.region.width;
  mirror.height = options.region.height;
  mirror.style.width = '100vw';
  mirror.style.height = '100vh';
  mirror.style.objectFit = 'contain';
  mirror.setAttribute('aria-label', options.title);
  doc.body.appendChild(mirror);
  const context = mirror.getContext('2d');

  let rafId = 0;
  let closed = false;

  const draw = () => {
    if (closed) return;
    if (context) {
      context.drawImage(
        options.sourceCanvas,
        options.region.x,
        options.region.y,
        options.region.width,
        options.region.height,
        0,
        0,
        mirror.width,
        mirror.height
      );
    }
    rafId = pipWindow.requestAnimationFrame(draw);
  };
  rafId = pipWindow.requestAnimationFrame(draw);

  const handleClosed = () => {
    if (closed) return;
    closed = true;
    pipWindow.cancelAnimationFrame(rafId);
    options.onClosed();
  };
  pipWindow.addEventListener('pagehide', handleClosed, {once: true});

  return {
    close() {
      if (!closed) {
        closed = true;
        pipWindow.cancelAnimationFrame(rafId);
      }
      pipWindow.close();
    },
  };
}
