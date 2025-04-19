'use client';

import { useState, useCallback, useRef } from 'react';
import styles from './FileUpload.module.css';

interface FileUploadProps {
  onFilesSelected: (files: File[]) => void;
}

export default function FileUpload({ onFilesSelected }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files).filter(file => 
      file.type === 'text/csv' || 
      file.name.endsWith('.xls') || 
      file.name.endsWith('.xlsx')
    );
    
    if (files.length > 0) {
      onFilesSelected(files);
    }
  }, [onFilesSelected]);

  const handleSelectClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files).filter(file => 
        file.type === 'text/csv' || 
        file.name.endsWith('.xls') || 
        file.name.endsWith('.xlsx')
      );
      
      if (files.length > 0) {
        onFilesSelected(files);
      }
    }
  }, [onFilesSelected]);

  return (
    <div 
      className={`${styles.uploadContainer} ${isDragging ? styles.dragging : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className={styles.uploadContent}>
        <input
          ref={fileInputRef}
          type="file"
          id="fileInput"
          className={styles.fileInput}
          accept=".csv,.xls,.xlsx"
          multiple
          onChange={handleFileSelect}
        />
        <label htmlFor="fileInput" className={styles.uploadLabel}>
          <div className={styles.uploadIcon}>📁</div>
          <div className={styles.uploadText}>
            <p>Drag and drop your files here</p>
            <p>or</p>
            <button 
              type="button"
              className={styles.selectButton}
              onClick={handleSelectClick}
            >
              Select Files
            </button>
          </div>
          <p className={styles.supportedFormats}>Supported formats: CSV, XLS, XLSX</p>
        </label>
      </div>
    </div>
  );
} 