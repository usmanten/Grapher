import type { GraphNode } from '@grapher/core';

import { type Index, kindGroup, nodeName, type TreeFolder } from '../model.js';

interface Props {
  index: Index;
  tree: TreeFolder;
  focus: string | undefined;
  protectedFiles: string[];
  onSelect: (id: string) => void;
}

function Item({
  node,
  label,
  focus,
  onSelect,
}: {
  node: GraphNode;
  label: string;
  focus: string | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={node.id === focus ? 'on' : undefined}
        aria-current={node.id === focus ? 'true' : undefined}
        onClick={() => {
          onSelect(node.id);
        }}
      >
        <span className="dot" data-kind={kindGroup(node)} />
        {label}
      </button>
    </li>
  );
}

function Folder({
  folder,
  index,
  focus,
  onSelect,
}: {
  folder: TreeFolder;
  index: Index;
  focus: string | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <ul>
      {folder.folders.map((child) => (
        <li key={`d:${child.name}`}>
          <div className="dir">{child.name}/</div>
          <Folder folder={child} index={index} focus={focus} onSelect={onSelect} />
        </li>
      ))}
      {folder.files.map((file) => {
        const node = index.nodes.get(file.id);
        return node ? (
          <Item key={file.id} node={node} label={file.name} focus={focus} onSelect={onSelect} />
        ) : null;
      })}
    </ul>
  );
}

export function FileTree({ index, tree, focus, protectedFiles, onSelect }: Props) {
  const outside = index.graph.nodes.filter((n) => n.kind !== 'file');
  return (
    <nav className="pane tree" aria-label="Files">
      <section>
        <h2>Your code</h2>
        <Folder folder={tree} index={index} focus={focus} onSelect={onSelect} />
        {protectedFiles.length > 0 && (
          <ul>
            {protectedFiles.map((path) => (
              <li key={path} className="locked" title="Grapher never opens this file">
                <span aria-hidden="true">🔒</span> {path} · never read
              </li>
            ))}
          </ul>
        )}
      </section>
      {outside.length > 0 && (
        <section>
          <h2>Outside your code</h2>
          <ul>
            {outside.map((node) => (
              <Item
                key={node.id}
                node={node}
                label={nodeName(node)}
                focus={focus}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </section>
      )}
    </nav>
  );
}
