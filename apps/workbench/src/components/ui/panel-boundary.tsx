'use client';

import { Component, type ReactNode } from 'react';

/** Keeps one panel's crash from taking the whole workbench down with it. */
export class PanelBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="border-line text-micro text-ink-muted mt-2.5 rounded-md border border-dashed p-3">
        {this.props.name} hit an error and was switched off; the rest of the page is fine.{' '}
        <button type="button" className="underline" onClick={() => this.setState({ failed: false })}>
          Try again
        </button>
      </div>
    );
  }
}
