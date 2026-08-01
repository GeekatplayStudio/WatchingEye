/**
 * Multimodal Dataset Store & Event Recall Engine.
 *
 * Persists Who, When, What evidence metadata and provides natural language
 * recall search across historical events and registered objects.
 */

export interface DatasetRecord {
  id: string;
  objectId: string;
  class: string;
  cameraId: string;
  timestamp: string;
  descriptors?: Array<{ key: string; value: string }>;
  licensePlate?: string;
  breedOrModel?: string;
  confidence: number;
  evidence: Array<{ label: string; description: string }>;
  snapshotRef: string;
}

export class DatasetStore {
  private records: DatasetRecord[] = [];

  public async insertRecord(record: DatasetRecord): Promise<void> {
    this.records.unshift(record);
    if (this.records.length > 2000) {
      this.records.pop();
    }
  }

  public async search(query: string, limit = 50): Promise<DatasetRecord[]> {
    const q = query.toLowerCase().trim();
    if (!q) return this.records.slice(0, limit);

    return this.records
      .filter((r) => {
        if (r.class.toLowerCase().includes(q)) return true;
        if (r.licensePlate && r.licensePlate.toLowerCase().includes(q)) return true;
        if (r.breedOrModel && r.breedOrModel.toLowerCase().includes(q)) return true;
        if (r.objectId.toLowerCase().includes(q)) return true;
        if (r.descriptors && r.descriptors.some((d) => d.value.toLowerCase().includes(q) || d.key.toLowerCase().includes(q))) return true;
        if (r.evidence && r.evidence.some((e) => e.label.toLowerCase().includes(q) || e.description.toLowerCase().includes(q))) return true;
        return false;
      })
      .slice(0, limit);
  }

  public async getAll(limit = 50): Promise<DatasetRecord[]> {
    return this.records.slice(0, limit);
  }

  /** Test helper — empty the in-memory store between cases. */
  public clear(): void {
    this.records = [];
  }
}

export const globalDatasetStore = new DatasetStore();
