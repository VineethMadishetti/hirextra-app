# Quick Setup Guide - AWS S3 Integration

## ✅ What's Already Done (Code Changes)
- ✅ AWS SDK installed
- ✅ S3 service created
- ✅ Upload flow updated to use S3
- ✅ Queue worker updated to process from S3
- ✅ All code changes complete

## 🔧 What YOU Need to Do

### Step 1: Create AWS S3 Bucket
1. Go to [AWS Console](https://console.aws.amazon.com/) → S3
2. Click **Create bucket**
3. Enter bucket name (e.g., `hirextra-uploads`)
4. Select region (e.g., `us-east-1`)
5. Click **Create bucket**

### Step 2: Create IAM User & Get Credentials
1. Go to **IAM** → **Users** → **Create user**
2. Username: `hirextra-s3-user`
3. Click **Next** → **Create user**
4. Click on the user → **Security credentials** tab
5. Click **Create access key**
6. Select **Application running outside AWS**
7. **SAVE THESE VALUES** (shown only once):
   - Access Key ID
   - Secret Access Key

### Step 3: Set IAM Permissions
1. In the IAM user page → **Add permissions** → **Create inline policy**
2. Click **JSON** tab → Paste this (replace `YOUR_BUCKET_NAME`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:HeadObject"
      ],
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME"
    }
  ]
}
```

3. Click **Next** → Name it `HirextraS3Access` → **Create policy**

### Step 4: Add Environment Variables

**For Local Development:**
Edit `server/.env` file and add:

```env
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_REGION=us-east-1
AWS_S3_BUCKET=hirextra-uploads
```

**For Render Deployment:**
1. Go to your Render dashboard
2. Select your service
3. Go to **Environment** tab
4. Add these environment variables:
   - `AWS_ACCESS_KEY_ID` = (your access key)
   - `AWS_SECRET_ACCESS_KEY` = (your secret key)
   - `AWS_REGION` = (your bucket region, e.g., `us-east-1`)
   - `AWS_S3_BUCKET` = (your bucket name)

### Step 5: Test It!
1. Start your server: `npm start` (or restart Render service)
2. Log in as admin
3. Upload a CSV file
4. Check your S3 bucket - you should see files in `uploads/` folder

## 📝 Example .env File

Your `server/.env` should look like this:

```env
NODE_ENV=production
PORT=5000
MONGO_URI=your-mongodb-connection-string
REDIS_HOST=your-redis-host
REDIS_PORT=6379
JWT_SECRET=your-jwt-secret
FRONTEND_URL=https://your-frontend-url.com

# AWS S3 Configuration
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_REGION=us-east-1
AWS_S3_BUCKET=hirextra-uploads
VITE_OPENAI_API_KEY=sk-proj-your-openai-key-here
```

## ⚠️ Important Notes

1. **Never commit `.env` file** - It's already in `.gitignore`
2. **Replace all placeholder values** with your actual AWS credentials
3. **Bucket name is case-sensitive** - Use exact name from AWS
4. **Region must match** - Use the same region where you created the bucket

## 🐛 Troubleshooting

**Error: "Access Denied"**
- Check IAM permissions are correct
- Verify bucket name matches exactly

**Error: "Bucket does not exist"**
- Double-check bucket name (case-sensitive)
- Verify region matches

**Files not uploading**
- Check server logs for errors
- Verify all 4 environment variables are set
- Test AWS credentials work (try AWS CLI)

## ✅ Checklist

- [ ] S3 bucket created
- [ ] IAM user created
- [ ] Access keys saved
- [ ] IAM permissions set
- [ ] Environment variables added to `.env` (local)
- [ ] Environment variables added to Render (production)
- [ ] Server restarted
- [ ] Test upload successful
- [ ] Files visible in S3 bucket

That's it! No code changes needed - just configuration! 🎉
