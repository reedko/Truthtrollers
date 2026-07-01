import React, { useState } from "react";
import { Handle, Position } from "reactflow";

const EditableNode = ({ data }: any) => {
  const [text, setText] = useState(data.label || "");

  const handleChange = (e: any) => {
    setText(e.target.value);
    // if you want changes to propagate upstream:
    if (data.onChange) {
      data.onChange(e.target.value);
    }
  };

  return (
    <div style={{ padding: 10, background: "#fff", border: "1px solid #999" }}>
      <input
        style={{ width: "100%" }}
        value={text}
        onChange={handleChange}
        onMouseDown={(e) => e.stopPropagation()}
      />
      <Handle type="source" position={Position.Right} />
      <Handle type="target" position={Position.Left} />
    </div>
  );
};

export default EditableNode;
