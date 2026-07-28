from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import spacy


@dataclass(frozen=True)
class ParsedText:
    text: str
    doc: Any

    def artifact(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "sentences": [
                {
                    "text": sent.text,
                    "startChar": sent.start_char,
                    "endChar": sent.end_char,
                    "tokens": [
                        {
                            "i": token.i,
                            "text": token.text,
                            "lemma": token.lemma_,
                            "pos": token.pos_,
                            "tag": token.tag_,
                            "dep": token.dep_,
                            "head": token.head.i,
                            "startChar": token.idx,
                            "endChar": token.idx + len(token.text),
                        }
                        for token in sent
                    ],
                    "entities": [
                        {
                            "text": entity.text,
                            "label": entity.label_,
                            "startChar": entity.start_char,
                            "endChar": entity.end_char,
                        }
                        for entity in self.doc.ents
                        if entity.start >= sent.start and entity.end <= sent.end
                    ],
                }
                for sent in self.doc.sents
            ],
        }


class Parser:
    def __init__(self, model: str = "en_core_web_trf") -> None:
        self.model_name = model
        self.nlp = spacy.load(model)

    def parse(self, text: str) -> ParsedText:
        return ParsedText(text=text, doc=self.nlp(text))

