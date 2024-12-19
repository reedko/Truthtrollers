import { useSlate } from "slate-react";
import { Editor, Transforms, Text } from "slate";
import { IconButton, Flex } from "@chakra-ui/react";
import { FiBold, FiItalic, FiUnderline } from "react-icons/fi";
import { BaseEditor } from "slate";
import { ReactEditor } from "slate-react";
import { HistoryEditor } from "slate-history";

type Format = "bold" | "italic" | "underline";

const isMarkActive = (
  editor: BaseEditor & ReactEditor & HistoryEditor,
  format: Format
): boolean => {
  const [match] = Editor.nodes(editor, {
    match: (n) => Text.isText(n) && n[format] === true,
    universal: true,
  });
  return !!match;
};

const toggleMark = (
  editor: BaseEditor & ReactEditor & HistoryEditor,
  format: Format
) => {
  const isActive = isMarkActive(editor, format);
  Transforms.setNodes(
    editor,
    { [format]: isActive ? null : true },
    { match: (n) => Text.isText(n), split: true }
  );
};

const ToolBar = () => {
  const editor = useSlate();

  return (
    <Flex mb={2} gap={2}>
      <IconButton
        icon={<FiBold />}
        aria-label="Bold"
        onClick={() => toggleMark(editor, "bold")}
        colorScheme={isMarkActive(editor, "bold") ? "blue" : "gray"}
        style={{ background: "white", color: "black", minHeight: "100%" }}
      />
      <IconButton
        icon={<FiItalic />}
        aria-label="Italic"
        onClick={() => toggleMark(editor, "italic")}
        colorScheme={isMarkActive(editor, "italic") ? "blue" : "gray"}
        style={{ background: "white", color: "black", minHeight: "100%" }}
      />
      <IconButton
        icon={<FiUnderline />}
        aria-label="Underline"
        onClick={() => toggleMark(editor, "underline")}
        colorScheme={isMarkActive(editor, "underline") ? "blue" : "gray"}
        style={{ background: "white", color: "black", minHeight: "100%" }}
      />
    </Flex>
  );
};

export default ToolBar;
