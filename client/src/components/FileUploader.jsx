import { useState, useEffect } from 'react';
import api from '../api/axios';
import { UploadCloud, CheckCircle, AlertCircle, Loader, FileText, X, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import AddFilesIcon from '../assets/add-files.svg';
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

        const { data } = await api.post('/candidates/upload-chunk', formData, {
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

          toast.success('Upload Complete! Preparing column mapping...', {
            duration: 1000,
            position: 'top-center',
          });
          onUploadComplete(data);
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
      className={`relative border-2 border-dashed rounded-2xl p-12 transition-all duration-300 ease-in-out
        ${dragActive ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-900/20 scale-[1.02] shadow-lg' : 'border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 hover:border-indigo-400 dark:hover:border-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800'}
      `}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      {/* IDLE - NO FILE */}
      {!file && status === 'idle' && (
        <div className="flex flex-col items-center gap-4 text-center">
          <img src={AddFilesIcon} alt="Upload CSV" className="w-24 h-24 dark:invert-[.85]" />
          <h3 className="text-xl font-semibold text-gray-800 dark:text-slate-200">Upload CSV File</h3>
          <p className="text-sm text-gray-500 dark:text-slate-400">
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
        <div className="flex flex-col items-center justify-center gap-4 text-center">
          <FileText className="w-16 h-16 text-blue-600 dark:text-blue-400" />

          <div className="min-w-0">
            <p className="font-semibold text-gray-800 dark:text-slate-200 truncate">{file.name}</p>
            <p className="text-sm text-gray-500 dark:text-slate-400">{formatFileSize(file.size)}</p>
          </div>

          <button
            onClick={() => {
              setFile(null);
              setProgress(0);
            }}
            className="text-sm text-slate-600 dark:text-slate-400 hover:underline"
          >
            or, Choose another file...
          </button>

          <button
            onClick={uploadFile}
            className="w-full max-w-xs bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-semibold flex items-center justify-center gap-2"
          >
            <UploadCloud className="w-5 h-5" />
            Upload File
          </button>
        </div>
      )}

      {/* UPLOADING */}
      {status === 'uploading' && (
        <div className="max-w-md mx-auto text-center space-y-4">
          <Loader className="w-12 h-12 text-blue-600 dark:text-blue-400 animate-spin mx-auto" />
          <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-sm text-gray-600 dark:text-slate-400">{progress}% uploading</p>
        </div>
      )}

      {/* SUCCESS */}
      {status === 'done' && (
        <div className="text-center space-y-4 animate-in fade-in zoom-in duration-300">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 mb-2">
            <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Upload Successful!</h3>
          <p className="text-slate-500 dark:text-slate-400">Your file is ready for mapping.</p>
          <button
            onClick={() => {
              setFile(null);
              setStatus('idle');
              setProgress(0);
            }}
            className="text-indigo-600 hover:text-indigo-500 font-medium text-sm hover:underline">
            Upload another file
          </button>
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
