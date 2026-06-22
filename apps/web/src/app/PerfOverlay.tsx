import {useEffect, useState} from 'preact/hooks';
import {
  isBrowserPerfActive,
  snapshotBrowserPerf,
  type PerfSnapshot,
} from '@incident/observability/browser';

export function PerfOverlay() {
  const [snapshot, setSnapshot] = useState<PerfSnapshot>(() =>
    snapshotBrowserPerf()
  );

  useEffect(() => {
    if (!isBrowserPerfActive()) return;
    const timer = window.setInterval(() => {
      setSnapshot(snapshotBrowserPerf());
    }, 500);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  if (!snapshot.enabled) return null;
  const stats = snapshot.frameStats;
  return (
    <aside class='perf-overlay' aria-label='開発用パフォーマンス'>
      <strong>DEV PERF</strong>
      <span>FPS {stats.fps}</span>
      <span>Draw {stats.lastDrawMs.toFixed(1)}ms</span>
      <span>p95 {stats.p95DrawMs.toFixed(1)}ms</span>
      <span>Slow {stats.slowDrawCount}</span>
      <span>{compactMark(snapshot.lastJourneyMark)}</span>
    </aside>
  );
}

function compactMark(mark: string | undefined) {
  if (!mark) return 'mark none';
  return mark.replace('incident.app.journey.', 'mark ');
}
