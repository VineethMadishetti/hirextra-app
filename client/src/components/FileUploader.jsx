import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { UploadCloud, CheckCircle, AlertCircle, Loader, FileText, X, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB per chunk (optimized for 15GB+ files)

const FileUploader = ({ onUploadComplete, fileId = null, onReprocess }) => {
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState(fileId ? 'processing' : 'idle'); // idle, uploading, done, error, processing
  const [dragActive, setDragActive] = useState(false);
  const [uploadAbortController, setUploadAbortController] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [showFieldMapping, setShowFieldMapping] = useState(false);
  const [mappedFields, setMappedFields] = useState({});
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const handleFileChange = (e) => {
    if (e.target.files[0]) {
      setFile(e.target.files[0]);
      setStatus('idle');
      setProgress(0);
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
      setStatus('idle');
      setProgress(0);
    }
  };

  // Check for existing upload state on mount
  useEffect(() => {
    const checkExistingUpload = async () => {
      if (fileId) {
        try {
          const { data } = await axios.get(`/api/files/${fileId}/status`);
          if (data.status === 'processing') {
            setStatus('processing');
            pollFileStatus(fileId);
          } else if (data.status === 'completed' && data.headers) {
            setStatus('done');
            setHeaders(data.headers);
            setShowFieldMapping(true);
          }
        } catch (error) {
          console.error('Error checking file status:', error);
          setStatus('error');
        }
      }
    };
    checkExistingUpload();
  }, [fileId]);

  const pollFileStatus = async (fileId) => {
    try {
      const { data } = await axios.get(`/api/files/${fileId}/status`);
      if (data.status === 'completed') {
        setStatus('done');
        setHeaders(data.headers || []);
        setShowFieldMapping(true);
        if (data.filePath) {
          onUploadComplete({ headers: data.headers, filePath: data.filePath });
        }
      } else if (data.status === 'failed') {
        setStatus('error');
      } else {
        // Continue polling
        setTimeout(() => pollFileStatus(fileId), 2000);
      }
    } catch (error) {
      console.error('Error polling file status:', error);
      setStatus('error');
    }
  };

  const handleReprocess = async () => {
    if (!fileId) return;
    try {
      setStatus('processing');
      const { data } = await axios.post(`/api/files/${fileId}/reprocess`);
      if (data.success) {
        pollFileStatus(fileId);
      } else {
        setStatus('error');
      }
    } catch (error) {
      console.error('Error reprocessing file:', error);
      setStatus('error');
    }
  };

  const handleFieldMapping = async () => {
    try {
      await axios.post(`/api/files/${fileId}/map-fields`, { mappings: mappedFields });
      // Invalidate queries that depend on this file
      queryClient.invalidateQueries(['file', fileId]);
      onUploadComplete({ headers: Object.values(mappedFields), fileId });
    } catch (error) {
      console.error('Error saving field mappings:', error);
    }
  };

  const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'https://hirextra-app.onrender.com/api',
  withCredentials: true,
  headers: {
    'Content-Type': 'multipart/form-data'
  }
});

  const uploadFile = async () => {
    if (!file) return;
    setStatus('uploading');
    
    // Persist upload state to sessionStorage
    const uploadState = {
      fileName: file.name,
      fileSize: file.size,
      timestamp: Date.now(),
      status: 'uploading'
    };
    sessionStorage.setItem('activeUpload', JSON.stringify(uploadState));
    
    // Create abort controller for cancellation
    const abortController = new AbortController();
    setUploadAbortController(abortController);

    // Improved: Warn before leaving page during upload
    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = 'Upload in progress. Are you sure you want to leave?';
      return e.returnValue;
    };
    
    // Store reference for cleanup
    window.addEventListener('beforeunload', handleBeforeUnload);

    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const fileName = `${Date.now()}_${file.name}`; // Unique name

    try {
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        // Check if upload was cancelled
        if (abortController.signal.aborted) {
          setStatus('error');
          window.removeEventListener('beforeunload', handleBeforeUnload);
          return;
        }

        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);

        const formData = new FormData();
        formData.append('file', chunk);
        formData.append('fileName', fileName);
        formData.append('chunkIndex', chunkIndex);
        formData.append('totalChunks', totalChunks);

        try {
          const { data } = await axios.post('/candidates/upload-chunk', formData, {
             withCredentials: true,
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 300000, // 5 minute timeout per chunk for very large files (15GB+)
            signal: abortController.signal,
            onUploadProgress: (progressEvent) => {
              // Track individual chunk upload progress
              if (progressEvent.total) {
                const chunkProgress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                // Update progress for current chunk
                const overallProgress = totalChunks > 1
                  ? Math.round(((chunkIndex / totalChunks) * 100) + (chunkProgress / totalChunks))
                  : chunkProgress;
                setProgress(Math.min(overallProgress, 99));
              }
            }
          });

          // Update progress bar after chunk completes
          const percent = Math.round(((chunkIndex + 1) / totalChunks) * 100);
          setProgress(Math.min(percent, 99)); // Keep at 99% until fully done

          // Check if this was the last chunk
          if (data.status === 'done') {
            console.log('✅ Upload complete, received headers:', data.headers?.length || 0);
            setStatus('done');
            setProgress(100);
            window.removeEventListener('beforeunload', handleBeforeUnload);
            sessionStorage.removeItem('activeUpload'); // Clear upload state
            setUploadAbortController(null);
            
            // Show success message
            toast.success(`File uploaded successfully! Found ${data.headers?.length || 0} columns.`);
            
            // Small delay to ensure UI updates and show success message
            setTimeout(() => {
              onUploadComplete(data); // Send headers/filepath back to parent
            }, 500);
            return;
          }
        } catch (error) {
          if (axios.isCancel(error)) {
            console.log('Upload cancelled');
            setStatus('error');
            window.removeEventListener('beforeunload', handleBeforeUnload);
            sessionStorage.removeItem('activeUpload');
            return;
          }
          console.error('Chunk upload error:', error);
          // If it's the last chunk and we get an error, it might still have completed
          if (chunkIndex === totalChunks - 1) {
            console.warn('Last chunk had error, but file might be uploaded. Checking...');
            // Could add a check here, but for now just show error
          }
          setStatus('error');
          window.removeEventListener('beforeunload', handleBeforeUnload);
          sessionStorage.removeItem('activeUpload');
          throw error;
        }
      }
    } catch (error) {
      if (!axios.isCancel(error)) {
        console.error('Upload failed:', error);
        setStatus('error');
      }
      window.removeEventListener('beforeunload', handleBeforeUnload);
      sessionStorage.removeItem('activeUpload');
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const renderFieldMapping = () => (
    <div className="mt-6 p-4 bg-gray-50 rounded-lg">
      <h4 className="font-semibold text-gray-700 mb-3">Map CSV Headers to Fields</h4>
      <div className="space-y-3 max-h-60 overflow-y-auto">
        {headers.map((header, index) => (
          <div key={index} className="flex items-center gap-3">
            <span className="text-sm text-gray-600 w-1/3 truncate">{header}</span>
            <select 
              className="flex-1 p-2 border rounded-md text-sm"
              value={mappedFields[header] || ''}
              onChange={(e) => setMappedFields(prev => ({
                ...prev,
                [header]: e.target.value
              }))}
            >
              <option value="">Select field...</option>
              <option value="name">Full Name</option>
              <option value="email">Email</option>
              <option value="phone">Phone</option>
              <option value="experience">Experience (Years)</option>
              <option value="skills">Skills</option>
              <option value="education">Education</option>
              <option value="current_company">Current Company</option>
              <option value="notice_period">Notice Period (Days)</option>
              <option value="current_ctc">Current CTC</option>
              <option value="expected_ctc">Expected CTC</option>
              <option value="country">Country</option>
              <option value="locality">Locality</option>
              <option value="location">Location</option>
              <option value="status">Status</option>
            </select>
          </div>
        ))}
      </div>
      <button
        onClick={handleFieldMapping}
        className="mt-4 w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-md text-sm font-medium transition-colors"
      >
        Save Mappings
      </button>
    </div>
  );

  return (
    <div 
      className={`relative border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
        dragActive 
          ? 'border-blue-500 bg-blue-50 shadow-md' 
          : status === 'done'
          ? 'border-green-500 bg-green-50 shadow-sm'
          : status === 'error'
          ? 'border-red-500 bg-red-50 shadow-sm'
          : 'border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50'
      }`}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      <div className={`flex gap-8 animate-fade-in w-full ${
  file && status === 'idle'
    ? 'flex-col lg:flex-row items-start'
    : 'flex-col items-center'
}`}>
        {status === 'done' && (
          <div className="w-full text-center">
            <div className="flex items-center justify-center gap-2 mb-4">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <span className="font-medium text-green-700">File processed successfully!</span>
            </div>
            {showFieldMapping ? (
              renderFieldMapping()
            ) : (
              <button
                onClick={() => setShowFieldMapping(true)}
                className="mt-2 text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 mx-auto"
              >
                <RefreshCw className="w-4 h-4" />
                Reconfigure Field Mapping
              </button>
            )}
          </div>
        )}
        {status === 'error' ? (
          <div className="text-center">
            <AlertCircle className="w-16 h-16 text-red-600 mx-auto" strokeWidth={2} />
            <p className="mt-2 text-red-600">Processing failed</p>
            <button
              onClick={handleReprocess}
              className="mt-3 px-4 py-2 bg-red-100 text-red-700 rounded-md text-sm font-medium hover:bg-red-200 transition-colors flex items-center gap-2 mx-auto"
            >
              <RefreshCw className="w-4 h-4" />
              Retry Processing
            </button>
          </div>
        ) : status === 'processing' ? (
          <div className="text-center">
            <Loader className="w-16 h-16 text-blue-600 animate-spin mx-auto" strokeWidth={2} />
            <p className="mt-3 text-gray-600">Processing file...</p>
            <p className="text-sm text-gray-500 mt-1">This may take a few moments</p>
          </div>
        ) : status === 'uploading' ? (
          <Loader className="w-16 h-16 text-blue-600 animate-spin" strokeWidth={2} />
        ) : (
          <UploadCloud className="w-16 h-16 text-gray-400" strokeWidth={1.5} />
        )}

        {status === 'idle' && (
          <div className="flex-1">
            <div className="space-y-2">
              <h3 className="text-2xl font-bold text-gray-800">Upload CSV File</h3>
              <p className="text-gray-500 text-sm">Drag and drop your file here, or click to browse</p>
              <p className="text-xs text-gray-400 mt-2">Supports .csv, .xlsx (Max 100MB)</p>
            </div>
            
            <label className="cursor-pointer group">
              <div className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-lg font-semibold shadow-sm transition-colors flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Select CSV File
              </div>
              <input 
                type="file" 
                accept=".csv" 
                className="hidden" 
                onChange={handleFileChange} 
              />
            </label>
            
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <div className="h-px bg-gray-300 flex-1"></div>
              <span className="font-medium">Supports files up to 30GB</span>
              <div className="h-px bg-gray-300 flex-1"></div>
            </div>
          </div>
        )}

        {file && status === 'idle' && (
  <div className="w-full max-w-md space-y-4 animate-slide-up lg:mt-12">
              <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="bg-blue-100 p-2 rounded-lg">
                      <FileText className="w-5 h-5 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-800 truncate">{file.name}</p>
                      <p className="text-sm text-gray-600">{formatFileSize(file.size)}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setFile(null);
                      setProgress(0);
                    }}
                    className="text-gray-400 hover:text-red-600 p-1 rounded hover:bg-red-50 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
            
            <button 
              onClick={uploadFile} 
              className="w-full bg-green-600 hover:bg-green-700 text-white px-8 py-4 rounded-lg font-semibold shadow-sm transition-colors flex items-center justify-center gap-2"
            >
              <UploadCloud className="w-5 h-5" />
              Start Upload
            </button>
          </div>
        )}

        {status === 'uploading' && (
          <div className="w-full max-w-md space-y-4 animate-slide-up">
            <div className="space-y-2">
              <div className="flex justify-between text-sm font-medium">
                <span className="text-gray-700">Uploading...</span>
                <span className="text-accent font-bold">{progress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
            </div>
            <p className="text-xs text-gray-500 flex items-center justify-center gap-2">
              <Loader className="w-3 h-3 animate-spin" />
              Please do not close this window
            </p>
          </div>
        )}

        {status === 'done' && (
          <div className="space-y-2">
            <p className="text-green-600 font-semibold text-lg">Upload Complete!</p>
            <p className="text-gray-600 text-sm">Preparing column mapping...</p>
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-4">
            <p className="text-red-600 font-semibold text-lg">Upload Failed</p>
            <p className="text-gray-600 text-sm">Please try again or check your file format</p>
            <button
              onClick={() => {
                setFile(null);
                setStatus('idle');
                setProgress(0);
              }}
              className="text-blue-600 hover:text-blue-700 font-semibold text-sm underline hover:no-underline transition-colors"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default FileUploader;