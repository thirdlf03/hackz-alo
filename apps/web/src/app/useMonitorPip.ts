import {useEffect, useRef, useState} from 'preact/hooks';
import {
  PIP_MONITOR_LABELS,
  pipRegionForMonitor,
  type PipMonitorId,
} from '../pure/pipMonitor.js';
import {
  isDocumentPipSupported,
  openMonitorPip,
  type PipMonitorHandle,
} from '../effect/pipMonitor.js';
import type {Screen} from './appTypes.js';

export interface MonitorPipControls {
  supported: boolean;
  /** PiP に取り外し中のモニター。 */
  detached: PipMonitorId[];
  toggle(monitorId: PipMonitorId): void;
}

/**
 * トリプルモニターの一部を Document PiP ウィンドウに「取り外す」。
 * ターミナル作業中もメトリクスやチャットを常時最前面で監視できる。
 */
export function useMonitorPip(options: {
  screen: Screen;
  canvasRef: {current: HTMLCanvasElement | null};
  setAppError: (message: string | undefined) => void;
}): MonitorPipControls {
  const [supported] = useState(() => isDocumentPipSupported());
  const [detached, setDetached] = useState<PipMonitorId[]>([]);
  const handlesRef = useRef(new Map<PipMonitorId, PipMonitorHandle>());

  const closeAll = () => {
    for (const handle of handlesRef.current.values()) {
      handle.close();
    }
    handlesRef.current.clear();
    setDetached([]);
  };

  useEffect(() => {
    if (options.screen !== 'play') closeAll();
  }, [options.screen]);

  useEffect(() => closeAll, []);

  const toggle = (monitorId: PipMonitorId) => {
    const existing = handlesRef.current.get(monitorId);
    if (existing) {
      existing.close();
      handlesRef.current.delete(monitorId);
      setDetached((current) => current.filter((id) => id !== monitorId));
      return;
    }
    const canvas = options.canvasRef.current;
    if (!supported || !canvas) return;
    void openMonitorPip({
      sourceCanvas: canvas,
      region: pipRegionForMonitor(monitorId),
      title: PIP_MONITOR_LABELS[monitorId],
      onClosed: () => {
        handlesRef.current.delete(monitorId);
        setDetached((current) => current.filter((id) => id !== monitorId));
      },
    })
      .then((handle) => {
        handlesRef.current.set(monitorId, handle);
        setDetached((current) =>
          current.includes(monitorId) ? current : [...current, monitorId]
        );
      })
      .catch((error: unknown) => {
        console.error(error);
        options.setAppError(
          'PiP ウィンドウを開けませんでした。ブラウザの設定を確認してください。'
        );
      });
  };

  return {supported, detached, toggle};
}
