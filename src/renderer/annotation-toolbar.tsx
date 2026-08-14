import { Trash2 } from "lucide-react";

export type SelectionAnchor = {
  exact: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
  x: number;
  y: number;
  range?: Range;
};

export function AnnotationToolbar(props: {
  selection: SelectionAnchor;
  noteBody: string;
  noteEditorOpen: boolean;
  onHighlight(color: "yellow" | "blue" | "green" | "pink"): void;
  onNoteBody(body: string): void;
  onToggleNote(): void;
  onSaveNote(): void;
  onClose(): void;
  onDelete?: () => void;
  deleteLabel?: string;
  editingNote?: boolean;
}) {
  const { selection, noteBody, noteEditorOpen } = props;
  return (
    <div
      className="annotation-toolbar"
      style={{ left: selection.x, top: selection.y }}
      aria-label={`已选择 ${selection.exact.length} 字`}
      onPointerDown={(event) => {
        if (!(event.target instanceof HTMLTextAreaElement))
          event.preventDefault();
      }}
    >
      {(["yellow", "blue", "green", "pink"] as const).map((color) => (
        <button
          key={color}
          type="button"
          className={`annotation-color ${color}`}
          onClick={() => props.onHighlight(color)}
          aria-label={`${color} 高亮`}
          title={props.onDelete ? "修改高亮颜色" : "添加高亮"}
        />
      ))}
      <span className="annotation-divider" />
      <button
        type="button"
        className="annotation-icon"
        onClick={props.onToggleNote}
        aria-label={props.editingNote ? "编辑批注" : "添加批注"}
        title={props.editingNote ? "编辑批注" : "添加批注"}
      >
        ✎
      </button>
      {props.onDelete && (
        <button
          type="button"
          className="annotation-icon danger"
          onClick={props.onDelete}
          aria-label={props.deleteLabel ?? "删除高亮"}
          title={props.deleteLabel ?? "删除高亮"}
        >
          <Trash2 size={15} />
        </button>
      )}
      <button
        type="button"
        className="annotation-icon"
        onClick={props.onClose}
        aria-label="关闭标注工具"
        title="关闭"
      >
        ×
      </button>
      {noteEditorOpen && (
        <div className="annotation-note-editor">
          <textarea
            autoFocus
            value={noteBody}
            onChange={(event) => props.onNoteBody(event.target.value)}
            placeholder="写下批注…"
            aria-label="批注内容"
          />
          <div>
            <button type="button" onClick={props.onToggleNote}>
              取消
            </button>
            <button
              type="button"
              disabled={!noteBody.trim()}
              onClick={props.onSaveNote}
            >
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
