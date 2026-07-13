import {ReplayPage} from '../../pages/ReplayPage.js';

export function ReplayScreen(props: {
  replayId: string;
  deepLinkValidated: boolean;
  timeline: Array<{at: number; label: string}>;
}) {
  if (!props.deepLinkValidated) {
    return (
      <section class='panel' aria-busy='true'>
        <p role='status'>リプレイを読み込み中…</p>
      </section>
    );
  }
  return <ReplayPage replayId={props.replayId} timeline={props.timeline} />;
}
