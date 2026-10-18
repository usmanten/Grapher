import {
  Background,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from '@xyflow/react';
import { useMemo } from 'react';

import { describeNode, type Index, kindGroup, type Layout, nodeName } from '../model.js';

// Labeled views need room between columns for the line labels.
const COLUMN_GAP = 460;
const COMPACT_COLUMN_GAP = 300;
const ROW_GAP = 92;

interface BoxData extends Record<string, unknown> {
  name: string;
  description: string;
  group: string;
  focused: boolean;
  highlighted: boolean;
}

interface HeadingData extends Record<string, unknown> {
  text: string;
}

type BoxNode = Node<BoxData, 'box'>;
type HeadingNode = Node<HeadingData, 'heading'>;

function Box({ data }: NodeProps<BoxNode>) {
  const classes = ['box', data.focused ? 'focus' : '', data.highlighted ? 'hl' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes} data-kind={data.group}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className="name">{data.name}</span>
      <span className="kind">{data.description}</span>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

function Heading({ data }: NodeProps<HeadingNode>) {
  return <div className="col-h">{data.text}</div>;
}

const nodeTypes = { box: Box, heading: Heading };

interface Props {
  index: Index;
  layout: Layout;
  focus: string | undefined;
  selected: string | undefined;
  showFocus: boolean;
  onSelectNode: (id: string) => void;
  onSelectConnection: (id: string) => void;
}

export function GraphCanvas({
  index,
  layout,
  focus,
  selected,
  showFocus,
  onSelectNode,
  onSelectConnection,
}: Props) {
  const selectedConnection = selected === undefined ? undefined : index.connections.get(selected);

  const nodes = useMemo(() => {
    const gap = layout.labels ? COLUMN_GAP : COMPACT_COLUMN_GAP;
    const result: (BoxNode | HeadingNode)[] = [];
    layout.columns.forEach((column, col) => {
      const top = -((column.nodes.length - 1) * ROW_GAP) / 2;
      if (column.heading) {
        result.push({
          id: `heading:${col}`,
          type: 'heading',
          position: { x: col * gap, y: top - 64 },
          data: { text: column.heading },
          selectable: false,
          draggable: false,
          focusable: false,
        });
      }
      column.nodes.forEach((id, row) => {
        const node = index.nodes.get(id);
        if (!node) return;
        result.push({
          id,
          type: 'box',
          position: { x: col * gap, y: top + row * ROW_GAP },
          data: {
            name: nodeName(node),
            description: describeNode(node),
            group: kindGroup(node),
            focused: showFocus && id === focus,
            highlighted: selectedConnection?.from === id || selectedConnection?.to === id,
          },
          draggable: false,
          ariaLabel: `${nodeName(node)}, ${describeNode(node)}`,
        });
      });
    });
    return result;
  }, [index, layout, focus, showFocus, selectedConnection]);

  const edges = useMemo(
    () =>
      layout.connections.map((c): Edge => {
        const on = c.id === selected;
        return {
          id: c.id,
          source: c.from,
          target: c.to,
          ...(layout.labels || on ? { label: c.label } : {}),
          className: on ? 'wire sel' : 'wire',
          markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
          interactionWidth: 18,
          focusable: true,
          ariaLabel: c.label,
          labelBgPadding: [8, 4],
          labelBgBorderRadius: 10,
        };
      }),
    [layout, selected],
  );

  return (
    <ReactFlow
      // A new layout gets a fresh canvas, so it is fitted to the screen again.
      key={`${layout.title}:${layout.connections.length}`}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.15, maxZoom: 1.1 }}
      minZoom={0.2}
      nodesConnectable={false}
      nodesDraggable={false}
      elementsSelectable
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_, node) => {
        if (node.type === 'box') onSelectNode(node.id);
      }}
      onEdgeClick={(_, edge) => {
        onSelectConnection(edge.id);
      }}
    >
      <Background gap={24} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
