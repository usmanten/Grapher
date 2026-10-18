import type { ViewerData } from '@grapher/core';
import { useMemo, useState } from 'react';

import { DetailsPanel } from './components/DetailsPanel.js';
import { FileTree } from './components/FileTree.js';
import { GraphCanvas } from './components/GraphCanvas.js';
import {
  connectionFor,
  defaultFocus,
  fileTree,
  indexGraph,
  layoutFor,
  type View,
} from './model.js';

const VIEWS: { id: View; label: string }[] = [
  { id: 'file', label: 'File view' },
  { id: 'flow', label: 'Full flow' },
  { id: 'overview', label: 'Overview' },
];

export function App({ data }: { data: ViewerData }) {
  const index = useMemo(() => indexGraph(data.graph), [data.graph]);
  const tree = useMemo(() => fileTree(data.graph), [data.graph]);
  const [view, setView] = useState<View>('file');
  const [focus, setFocus] = useState(() => defaultFocus(data.graph));
  const [selected, setSelected] = useState(() =>
    focus === undefined ? undefined : connectionFor(index, focus, undefined),
  );
  const layout = useMemo(() => layoutFor(index, view, focus), [index, view, focus]);

  const selectNode = (id: string) => {
    setFocus(id);
    setView('file');
    setSelected(connectionFor(index, id, selected));
  };

  return (
    <div className="app">
      <header>
        <div className="brand">
          Grapher<span>{data.graph.project.name}</span>
        </div>
        <div className="views" role="group" aria-label="View">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={view === v.id}
              onClick={() => {
                setView(v.id);
              }}
            >
              {v.label}
            </button>
          ))}
        </div>
        {data.graph.warnings.map((w) => (
          <div key={w.message} className="note" role="note">
            {w.message}
          </div>
        ))}
      </header>
      <div className="main">
        <FileTree
          index={index}
          tree={tree}
          focus={focus}
          protectedFiles={data.protectedFiles}
          onSelect={selectNode}
        />
        <section className="pane canvas" aria-label="Graph">
          <div className="canvas-head">
            <h1>{layout.title}</h1>
            <p>{layout.subtitle}</p>
            {view === 'file' && focus !== undefined && (
              <button
                type="button"
                className="trace"
                onClick={() => {
                  setView('flow');
                }}
              >
                Trace full flow
              </button>
            )}
            <p className="legend">Arrows point from the code doing something to what it uses.</p>
          </div>
          <div className="stage">
            <GraphCanvas
              index={index}
              layout={layout}
              focus={focus}
              selected={selected}
              showFocus={view !== 'overview'}
              onSelectNode={selectNode}
              onSelectConnection={setSelected}
            />
          </div>
        </section>
        <DetailsPanel index={index} root={data.root} selected={selected} />
      </div>
    </div>
  );
}
