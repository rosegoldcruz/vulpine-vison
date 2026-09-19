export interface ProjectFile {
  id: string;
  name: string;
  path: string;
  size: number;
  mimeType: string;
}

export interface ProjectManifest {
  projectId: string;
  projectName: string;
  files: ProjectFile[];
  pdfFiles: ProjectFile[];
  workbookFiles: ProjectFile[];
  pageCount: number;
  createdAt: string;
  processingStatus: 'created' | 'uploaded' | 'processing' | 'ready' | 'failed';
}
