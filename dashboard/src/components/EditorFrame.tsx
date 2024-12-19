import React, { useMemo, useState, useCallback } from "react";
import { createEditor, Descendant } from "slate";
import { withHistory } from "slate-history";
import { Slate, Editable, withReact } from "slate-react";
import { Box, Button, HStack } from "@chakra-ui/react";
import { BaseEditor } from "slate";
import { ReactEditor } from "slate-react";
import { HistoryEditor } from "slate-history";
import ToolBar from "./ToolBar";

type CustomText = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
};

type CustomElement = {
  type: "paragraph";
  children: CustomText[];
};

// Extend the Slate module to include our custom types
declare module "slate" {
  interface CustomTypes {
    Editor: BaseEditor & ReactEditor & HistoryEditor;
    Element: CustomElement;
    Text: CustomText;
  }
}

const fillItLstring: string = ``;
const initialValue: Descendant[] = [
  {
    type: "paragraph",
    children: [{ text: fillItLstring }],
  },
];

export const EditorFrame = () => {
  const [value, setValue] = useState<Descendant[]>(initialValue);
  const editor = useMemo(() => withHistory(withReact(createEditor())), []);

  const onChange = (newValue: Descendant[]) => setValue(newValue);

  const handleSave = () => {
    // Here you could persist your data to a server or store
    alert("Content saved!");
  };

  return (
    <Box borderWidth="1px" borderRadius="lg" p={4} w="100%" h="440px">
      <Slate editor={editor} initialValue={value} onChange={onChange}>
        <HStack spacing={2} mb={2}>
          {/* Add formatting buttons here if needed */}
          <Button size="sm" onClick={handleSave}>
            Save
          </Button>
        </HStack>
        <Box borderWidth="1px" borderRadius="md" bg="white" p={2}>
          <ToolBar />
          <Editable
            placeholder="Start typing..."
            style={{
              background: "white",
              color: "black",
              minHeight: "100%",
              height: "300px",
            }}
          />
        </Box>
      </Slate>
    </Box>
  );
};
