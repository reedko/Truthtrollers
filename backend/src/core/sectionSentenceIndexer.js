/**
 * sectionSentenceIndexer.js
 *
 * Split semantic section text into numbered sentences.
 * Preserve exact character offsets for canonical excerpt reconstruction.
 * Support deterministic sourceSentenceId validation.
 */

export class SectionSentenceIndexer {
  constructor(options = {}) {
    // Sentence boundary patterns
    this.sentenceEndPattern = /[.!?]+(?=\s+[A-Z]|\s*$)/g;
    this.abbrevPattern = /\b(?:Mr|Mrs|Ms|Dr|Prof|Inc|etc|vs|e\.g|i\.e|Ph\.D|M\.D|U\.S)\./gi;
  }

  /**
   * Split section text into sentences with character offsets.
   * Returns array of { sentenceId, text, charStart, charEnd }
   */
  indexSectionSentences(sectionText) {
    if (!sectionText) return [];

    const sentences = [];
    let currentStart = 0;
    let sentenceId = 1;

    // Split on sentence boundaries while preserving text
    const parts = sectionText.split(/(?<=[.!?])\s+(?=[A-Z])|(?<=[.!?])$/);

    for (const part of parts) {
      if (!part || part.trim().length === 0) continue;

      const trimmedPart = part.trim();
      const charStart = sectionText.indexOf(trimmedPart, currentStart);
      const charEnd = charStart + trimmedPart.length;

      sentences.push({
        sentenceId,
        text: trimmedPart,
        charStart,
        charEnd,
      });

      currentStart = charEnd;
      sentenceId++;
    }

    return sentences;
  }

  /**
   * Create sentence-numbered version for LLM input.
   * Format: [S1] Sentence text. [S2] Sentence text.
   */
  createNumberedText(sectionText) {
    const sentences = this.indexSectionSentences(sectionText);

    const numberedLines = sentences.map(s => `[S${s.sentenceId}] ${s.text}`);

    return {
      numberedText: numberedLines.join("\n"),
      sentences,
      sentenceCount: sentences.length,
    };
  }

  /**
   * Rebuild canonical excerpt from sourceSentenceIds.
   * Returns { excerpt, charStart, charEnd, rebuiltFromIds }
   */
  rebuildExcerptFromSentenceIds(sectionText, sourceSentenceIds, sentencesMap) {
    if (!sourceSentenceIds || sourceSentenceIds.length === 0) {
      return {
        excerpt: "",
        charStart: -1,
        charEnd: -1,
        rebuiltFromIds: false,
        warning: "no_source_sentence_ids",
      };
    }

    // Get sentences in order
    const sortedIds = [...sourceSentenceIds].sort((a, b) => a - b);
    const selectedSentences = sortedIds
      .map(id => sentencesMap.find(s => s.sentenceId === id))
      .filter(s => s);

    if (selectedSentences.length === 0) {
      return {
        excerpt: "",
        charStart: -1,
        charEnd: -1,
        rebuiltFromIds: false,
        warning: "sentence_ids_not_found_in_map",
      };
    }

    // Check continuity (allow small gaps for punctuation)
    const charStart = selectedSentences[0].charStart;
    const charEnd = selectedSentences[selectedSentences.length - 1].charEnd;

    // Extract from original text
    const excerpt = sectionText.substring(charStart, charEnd).trim();

    return {
      excerpt,
      charStart,
      charEnd,
      rebuiltFromIds: true,
      sentenceCount: selectedSentences.length,
    };
  }

  /**
   * Validate sourceSentenceIds against sentence map.
   */
  validateSourceSentenceIds(sourceSentenceIds, sentencesMap) {
    if (!sourceSentenceIds || sourceSentenceIds.length === 0) {
      return { valid: true, warnings: ["empty_source_sentence_ids"] };
    }

    const warnings = [];
    const maxId = Math.max(...sentencesMap.map(s => s.sentenceId));

    for (const id of sourceSentenceIds) {
      if (!Number.isInteger(id)) {
        warnings.push(`invalid_source_id_type: ${id}`);
      } else if (id < 1 || id > maxId) {
        warnings.push(`source_id_out_of_range: ${id} (max ${maxId})`);
      }
    }

    return {
      valid: warnings.length === 0,
      warnings,
    };
  }
}

export default SectionSentenceIndexer;
