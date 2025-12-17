# JWT Configuration Fix

## Problem
Files were uploading to S3 successfully, but processing wasn't starting because JWT tokens weren't being created, causing authentication to fail.

## Root Cause
If `JWT_SECRET` is not set in Render environment variables:
1. JWT tokens cannot be created during login
2. Authentication middleware fails
3. `processFile` endpoint returns 401 Unauthorized
4. File processing never starts (even though file is in S3)

## Fixes Applied

### 1. Server Startup Validation (`server.js`)
- Added validation to check for `JWT_SECRET` and `MONGODB_URI` at startup
- Server will exit with clear error message if `JWT_SECRET` is missing
- Prevents server from starting with invalid configuration

### 2. JWT Generation Error Handling (`authController.js`)
- Added checks in `generateAccessToken()`, `generateRefreshToken()`, and `generateToken()`
- Added error handling in `loginUser()` and `registerUser()`
- Returns clear error messages if JWT_SECRET is missing

### 3. Better Error Messages
- Login/registration now return specific error codes: `JWT_CONFIG_ERROR`
- Logs errors to help with debugging

## Required Environment Variables in Render

Make sure these are set in your Render dashboard → Environment tab:

### Critical (Required)
- ✅ `JWT_SECRET` - **MUST be set!** (e.g., a long random string)
- ✅ `MONGODB_URI` - MongoDB connection string
- ✅ `AWS_S3_BUCKET` or `AWS_S3_BUCKET_NAME` - Your S3 bucket name
- ✅ `AWS_ACCESS_KEY_ID` - AWS access key
- ✅ `AWS_SECRET_ACCESS_KEY` - AWS secret key
- ✅ `AWS_REGION` - AWS region (e.g., `us-east-1`)

### Optional
- `REFRESH_TOKEN_SECRET` - If not set, uses `JWT_SECRET`
- `REDIS_URL` - Redis connection (defaults to `redis://localhost:6379`)

## How to Set JWT_SECRET in Render

1. Go to your Render dashboard
2. Select your backend service
3. Go to **Environment** tab
4. Click **Add Environment Variable**
5. Add:
   - **Key**: `JWT_SECRET`
   - **Value**: Generate a secure random string (at least 32 characters)
   
   Example (generate a secure one):
   ```bash
   # Generate a secure JWT secret (run locally)
   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
   ```

6. Click **Save Changes**
7. Render will automatically redeploy

## Testing

After setting `JWT_SECRET`:

1. **Check server logs** - Should see server starting without errors
2. **Try logging in** - Should receive JWT token in cookies
3. **Upload a file** - Should upload to S3
4. **Process the file** - Should start processing (check job status)

## Error Messages to Look For

### Server Startup
```
❌ Missing required environment variables: JWT_SECRET
❌ JWT_SECRET is not set or is using default value!
```

### Login/Registration
```json
{
  "message": "Server configuration error: JWT_SECRET is not set",
  "code": "JWT_CONFIG_ERROR"
}
```

### Authentication
```json
{
  "message": "Access token missing",
  "code": "NO_ACCESS_TOKEN"
}
```

## Verification Checklist

- [ ] `JWT_SECRET` is set in Render environment variables
- [ ] `JWT_SECRET` is NOT the default value (`your-super-secure-jwt-secret-key-here`)
- [ ] Server starts without errors
- [ ] Login works and returns user data
- [ ] File uploads to S3 successfully
- [ ] File processing starts after mapping
- [ ] Job status updates correctly

## Next Steps

1. **Set JWT_SECRET in Render** (if not already set)
2. **Redeploy** your service
3. **Test login** - verify JWT token is created
4. **Test file upload and processing** - should work end-to-end
