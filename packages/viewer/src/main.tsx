import '@xyflow/react/dist/style.css';
import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { loadViewerData } from './data.js';

const container = document.getElementById('root');
if (container) {
  const data = loadViewerData(document);
  createRoot(container).render(
    <StrictMode>
      {data ? (
        <App data={data} />
      ) : (
        <p className="empty">
          This page has no graph data. Run <code>grapher graph</code> in your project to create it.
        </p>
      )}
    </StrictMode>,
  );
}
