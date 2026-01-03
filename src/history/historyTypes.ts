import type { FFAStyleTemplate } from "@/graph/schema";

export interface HistoryEntry {
  id: string;
  timestamp: number;
  subject: string;
  compiledJson: FFAStyleTemplate;
  finalPrompt: string;
  generationParams: {
    model: string;
    size: string;
  };
  image: string; // data URL
}

