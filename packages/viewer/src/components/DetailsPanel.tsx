import { describeConnection, editorLink, type Index, shortName } from '../model.js';

interface Props {
  index: Index;
  root: string;
  selected: string | undefined;
}

export function DetailsPanel({ index, root, selected }: Props) {
  const connection = selected === undefined ? undefined : index.connections.get(selected);
  const from = connection && index.nodes.get(connection.from);
  const to = connection && index.nodes.get(connection.to);

  if (!connection || !from || !to) {
    return (
      <aside className="pane explain" aria-live="polite" aria-label="Explanation">
        <h2>Explanation</h2>
        <p>
          Click any line between two boxes to see what that connection does and where it is in the
          code.
        </p>
      </aside>
    );
  }

  return (
    <aside className="pane explain" aria-live="polite" aria-label="Explanation">
      <h2>Explanation</h2>
      <h3>
        <code>{shortName(from)}</code> → <code>{shortName(to)}</code>
      </h3>
      <span className="verb">{connection.label}</span>
      <p className="summary">{describeConnection(index, connection)}</p>
      <div className="refs">
        <h4>Where in the code</h4>
        <ul>
          {connection.locations.map((loc) => (
            <li key={`${loc.path}:${loc.line}`}>
              <a className="ref" href={root ? editorLink(root, loc.path, loc.line) : undefined}>
                {loc.path}:{loc.line}
              </a>
              <span className="ref-role">{loc.role === 'import' ? 'brings it in' : 'uses it'}</span>
            </li>
          ))}
        </ul>
      </div>
      {to.kind === 'setting' && (
        <div className="secret">
          <span aria-hidden="true">🔒</span> Only the setting&apos;s name is shown. Grapher never
          opens .env files, so the value is never in this page.
        </div>
      )}
      <div className="hint">
        Click a box to make it the selected file. Links open the line in VS Code.
      </div>
    </aside>
  );
}
