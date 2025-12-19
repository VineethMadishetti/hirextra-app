import { useState, useEffect } from 'react';
import axios from 'axios';
import { UploadCloud, CheckCircle, AlertCircle, Loader, FileText, X, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB

const FileUploader = ({ onUploadComplete, fileId = null }) => {
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState(fileId ? 'processing' : 'idle');
  const [dragActive, setDragActive] = useState(false);
  const queryClient = useQueryClient();

  const handleFileChange = (e) => {
    if (e.target.files?.[0]) {
      setFile(e.target.files[0]);
      setStatus('idle');
      setProgress(0);
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === 'dragenter' || e.type === 'dragover');
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) {
      setFile(e.dataTransfer.files[0]);
      setStatus('idle');
      setProgress(0);
    }
  };

  const uploadFile = async () => {
    if (!file) return;

    setStatus('uploading');
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const fileName = `${Date.now()}_${file.name}`;

    try {
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);

        const formData = new FormData();
        formData.append('file', chunk);
        formData.append('fileName', fileName);
        formData.append('chunkIndex', chunkIndex);
        formData.append('totalChunks', totalChunks);

        const { data } = await axios.post('/candidates/upload-chunk', formData, {
          withCredentials: true,
          timeout: 300000,
          onUploadProgress: (e) => {
            if (e.total) {
              const percent = Math.round(
                ((chunkIndex + e.loaded / e.total) / totalChunks) * 100
              );
              setProgress(Math.min(percent, 99));
            }
          },
        });

        if (data.status === 'done') {
          setProgress(100);
          setStatus('done');

          toast.success('File uploaded successfully!', {
            duration: 1000,
            position: 'top-center',
          });

          setTimeout(() => {
            onUploadComplete(data);
          }, 500);

          return;
        }
      }
    } catch (err) {
      console.error(err);
      setStatus('error');
      toast.error('Upload failed', { position: 'top-center' });
    }
  };

  const formatFileSize = (bytes) => {
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  return (
    <div
      className={`relative border-2 border-dashed rounded-xl p-12 transition-colors
        ${dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-gray-50'}
      `}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      {/* IDLE - NO FILE */}
      {!file && status === 'idle' && (
        <div className="flex flex-col items-center gap-4 text-center">
          <UploadCloud className="w-16 h-16 text-gray-400" />
          <h3 className="text-xl font-semibold text-gray-800">Upload CSV File</h3>
          <p className="text-sm text-gray-500">
            Drag & drop your CSV here or select a file
          </p>

          <label className="cursor-pointer">
            <div className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Select CSV File
            </div>
            <input type="file" accept=".csv" hidden onChange={handleFileChange} />
          </label>
        </div>
      )}

      {/* FILE SELECTED (CENTER COLUMN LAYOUT) */}
      {file && status === 'idle' && (
        <div className="flex flex-col items-center justify-center gap-6 max-w-md mx-auto">
          <UploadCloud className="w-14 h-14 text-blue-600" />

          <div className="w-full bg-white border rounded-lg p-4 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <FileText className="w-5 h-5 text-blue-600" />
              <div className="min-w-0">
                <p className="font-medium text-gray-800 truncate">{file.name}</p>
                <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
              </div>
            </div>
            <button
              onClick={() => setFile(null)}
              className="text-gray-400 hover:text-red-600"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <button
            onClick={uploadFile}
            className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-semibold flex items-center justify-center gap-2"
          >
            <UploadCloud className="w-5 h-5" />
            Upload File
          </button>
        </div>
      )}

      {/* UPLOADING */}
      {status === 'uploading' && (
        <div className="max-w-md mx-auto text-center space-y-4">
          <Loader className="w-12 h-12 text-blue-600 animate-spin mx-auto" />
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-sm text-gray-600">{progress}% uploading</p>
        </div>
      )}

      {/* ERROR */}
      {status === 'error' && (
        <div className="text-center space-y-3">
          <AlertCircle className="w-14 h-14 text-red-600 mx-auto" />
          <p className="text-red-600 font-semibold">Upload failed</p>
          <button
            onClick={() => {
              setFile(null);
              setStatus('idle');
              setProgress(0);
            }}
            className="text-blue-600 underline text-sm"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
};

export default FileUploader;
