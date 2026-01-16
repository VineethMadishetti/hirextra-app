import React from 'react';

const Loading = ({ size = 'medium', text = 'Loading...' }) => {
  const sizeClasses = {
    small: 'w-5 h-5 border-2',
    medium: 'w-8 h-8 border-3',
    large: 'w-12 h-12 border-4',
  };

  return (
    <div className="flex flex-col items-center justify-center p-4 space-y-3">
      <div
        className={`${sizeClasses[size]} animate-spin rounded-full border-gray-200 border-t-blue-600`}
        role="status"
        aria-label="loading"
      >
        <span className="sr-only">Loading...</span>
      </div>
      {text && <p className="text-sm text-gray-500 font-medium animate-pulse">{text}</p>}
    </div>
  );
};

export default Loading;