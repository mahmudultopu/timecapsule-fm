import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RecordingDetailView } from '@/components/recording/RecordingDetailView';
import { ProvenanceList } from '@/components/recording/ProvenanceList';
import { PlayerProvider } from '@/components/player/PlayerProvider';
import { recording, renderWithIntl } from './utils';

vi.mock('@/lib/api', () => ({ getPlayback: vi.fn() }));

const withPlayer = (ui: React.ReactElement) => renderWithIntl(<PlayerProvider>{ui}</PlayerProvider>);

describe('ProvenanceList', () => {
  it('shows every provenance field', () => {
    renderWithIntl(<ProvenanceList provenance={recording.provenance} />);
    const list = screen.getByRole('region', { name: 'Provenance' });
    for (const text of [
      'Original field recording',
      '1982-01-01 – 1982-12-31',
      'Approximate',
      'Unknown',
      'About 1 km',
      'Owned by contributor',
      'CC BY 4.0',
      'A. Recordist',
      'A. Recordist, CC BY 4.0',
      'No identifiable speech',
    ]) {
      expect(within(list).getByText(text)).toBeInTheDocument();
    }
  });

  it('renders a notice instead of partial provenance', () => {
    const { license: _drop, ...partial } = recording.provenance;
    renderWithIntl(<ProvenanceList provenance={partial} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/incomplete/);
    expect(screen.queryByText('Original field recording')).not.toBeInTheDocument();
  });

  it('shows how a reconstruction was made', () => {
    renderWithIntl(
      <ProvenanceList
        provenance={{
          ...recording.provenance,
          sourceType: 'community_reconstruction',
          syntheticDisclosure: 'Layered from 2026 recordings.',
        }}
      />,
    );
    expect(screen.getByText('How this was made')).toBeInTheDocument();
    expect(screen.getByText('Layered from 2026 recordings.')).toBeInTheDocument();
  });
});

describe('RecordingDetailView', () => {
  it('shows place names in both forms, with the local language marked', () => {
    withPlayer(<RecordingDetailView recording={recording} />);
    expect(screen.getByRole('heading', { name: 'Shibuya Crossing' })).toBeInTheDocument();
    const local = screen.getByText('渋谷スクランブル交差点');
    expect(local).toHaveAttribute('lang', 'ja');
    expect(local).toHaveAttribute('dir', 'auto');
    expect(screen.getByText('Traffic and footsteps at a busy crossing.')).toBeInTheDocument();
  });

  it('labels reconstructions and demo data prominently', () => {
    withPlayer(
      <RecordingDetailView
        recording={{
          ...recording,
          isDemo: true,
          provenance: { ...recording.provenance, sourceType: 'community_reconstruction', syntheticDisclosure: 'Synthetic.' },
        }}
      />,
    );
    expect(screen.getByText(/not an authentic recording/)).toBeInTheDocument();
    expect(screen.getByText('Demo placeholder')).toBeInTheDocument();
  });

  it('refuses to display a recording without provenance', () => {
    withPlayer(
      <RecordingDetailView recording={{ ...recording, provenance: { ...recording.provenance, rightsHolder: undefined as never } }} />,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Shibuya Crossing' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Play/ })).not.toBeInTheDocument();
  });

  it('renders contributor text as text, never HTML', () => {
    withPlayer(
      <RecordingDetailView
        recording={{ ...recording, sceneDescription: { en: '<img src=x onerror=alert(1)> crowd noise', local: null } }}
      />,
    );
    expect(screen.getByText('<img src=x onerror=alert(1)> crowd noise')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });
});
