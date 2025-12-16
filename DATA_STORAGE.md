# Data Storage Information

## Database
- **Type**: MongoDB (NoSQL Document Database)
- **Connection**: Configured via `MONGO_URI` environment variable
- **Location**: MongoDB instance (can be local or cloud-hosted)
- **Docker Volume**: If using Docker, data is stored in `mongo-data` volume

## Data Models

### Candidates Collection
- Stores individual candidate records
- Fields: fullName, email, phone, company, jobTitle, skills, location, etc.
- Indexed fields: fullName, jobTitle, skills, location, email
- Soft delete support: `isDeleted` flag (default: false)

### UploadJobs Collection
- Tracks file upload and processing jobs
- Fields: fileName, status, totalRows, successRows, mapping, etc.
- Status values: UPLOADING, MAPPING_PENDING, PROCESSING, COMPLETED, FAILED

### Users Collection
- Stores user accounts (Admin/User roles)
- Fields: name, email, password (hashed), role

## File Storage
- **Upload Directory**: `uploads/` folder on server
- **Temporary Chunks**: `temp_chunks/` folder (cleaned after upload)
- Files are stored on the server filesystem, not in database

## Large File Handling (14GB+)

### Current Implementation
- **Chunked Upload**: Files are split into 10MB chunks
- **Streaming**: Server uses streams for memory-efficient file handling
- **Queue System**: Uses Bull (Redis) for background job processing
- **Batch Processing**: Processes candidates in batches of 5000

### Scalability Considerations
1. **MongoDB**: Can handle large datasets, but consider:
   - Index optimization
   - Sharding for very large collections (100M+ documents)
   - Connection pooling

2. **File Storage**: 
   - Server disk space for uploaded files
   - Consider cloud storage (S3, Azure Blob) for production

3. **Memory**:
   - Streaming prevents loading entire files into memory
   - Batch processing limits memory usage

4. **Multiple 14GB Files**:
   - Each file is processed independently
   - Queue system handles concurrent processing
   - Monitor server resources (CPU, RAM, disk I/O)

### Recommendations for Production
1. Use cloud storage (AWS S3, Azure Blob Storage) instead of local filesystem
2. Implement MongoDB sharding for very large datasets
3. Add monitoring for queue processing times
4. Consider database read replicas for search performance
5. Implement data archival strategy for old uploads

## Redis Queue
- Used for background job processing
- Stores job state and progress
- Helps prevent server overload during large file processing
