// src/Legend.tsx

import React from "react";

const Legend: React.FC = () => {
  const items = [
    { color: "#1f77b4", label: "Author" },
    { color: "#ff7f0e", label: "Task" },
    { color: "#2ca02c", label: "Publisher" },
    { color: "#d62728", label: "Reference" },
  ];

  return (
    <div
      style={{
        display: "flex",
        gap: "15px",
        marginBottom: "20px",
        justifyContent: "center",
      }}
    >
      {items.map((item, index) => (
        <div key={index} style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              width: "15px",
              height: "15px",
              backgroundColor: item.color,
              marginRight: "5px",
              borderRadius: "50%",
            }}
          ></div>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
};

export default Legend;
