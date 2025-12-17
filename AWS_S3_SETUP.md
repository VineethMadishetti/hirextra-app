# AWS S3 Integration Setup Guide

This guide will help you configure AWS S3 for file storage in your Hirextra application.

## Prerequisites

1. An AWS account
2. An S3 bucket created in AWS Console
3. AWS Access Key ID and Secret Access Key

## Step 1: Create S3 Bucket

1. Log in to [AWS Console](https://console.aws.amazon.com/)
2. Navigate to **S3** service
3. Click **Create bucket**
4. Configure your bucket:
   - **Bucket name**: Choose a unique name (e.g., `hirextra-uploads`)
   - **Region**: Choose your preferred region (e.g., `us-east-1`)
   - **Block Public Access**: Keep default settings (all blocked)
   - **Versioning**: Optional (recommended for production)
   - **Encryption**: Enable server-side encryption (recommended)
5. Click **Create bucket**

## Step 2: Create IAM User and Access Keys

1. Navigate to **IAM** service in AWS Console
2. Click **Users** → **Create user**
3. Enter a username (e.g., `hirextra-s3-user`)
4. Select **Provide user access to the AWS Management Console** → **No**
5. Click **Next**
6. Click **Create user**
7. Click on the newly created user
8. Go to **Security credentials** tab
9. Click **Create access key**
10. Select **Application running outside AWS**
11. Click **Next** → **Create access key**
12. **IMPORTANT**: Copy and save both:
    - **Access key ID**
    - **Secret access key** (shown only once)

## Step 3: Configure IAM Permissions

1. In the IAM user page, click **Add permissions** → **Create inline policy**
2. Click **JSON** tab and paste the following policy:

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
      "Action": [
        "s3:ListBucket"
      ],
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME"
    }
  ]
}
```

3. Replace `YOUR_BUCKET_NAME` with your actual bucket name
4. Click **Next** → Enter policy name (e.g., `HirextraS3Access`)
5. Click **Create policy**

## Step 4: Configure Environment Variables

Add the following variables to your `.env` file in the `server` directory:

```env
# AWS S3 Configuration
AWS_ACCESS_KEY_ID=your-access-key-id-here
AWS_SECRET_ACCESS_KEY=your-secret-access-key-here
AWS_REGION=us-east-1
AWS_S3_BUCKET=your-bucket-name
```

**Important Notes:**
- Replace `your-access-key-id-here` with your actual Access Key ID
- Replace `your-secret-access-key-here` with your actual Secret Access Key
- Replace `us-east-1` with your bucket's region if different
- Replace `your-bucket-name` with your actual bucket name

## Step 5: Test the Integration

1. Start your server:
   ```bash
   cd server
   npm start
   ```

2. Try uploading a file through the admin dashboard
3. Check your S3 bucket in AWS Console - you should see files in the `uploads/` folder

## File Structure in S3

Files are stored with the following structure:
```
uploads/
  └── {userId}/
      └── {timestamp}_{filename}.csv
```

Example:
```
uploads/507f1f77bcf86cd799439011/1704067200000_candidates.csv
```

## Troubleshooting

### Error: "Access Denied"
- Verify your IAM user has the correct permissions
- Check that the bucket name in `.env` matches your actual bucket name
- Ensure the bucket policy allows your IAM user

### Error: "Bucket does not exist"
- Verify the bucket name is correct (case-sensitive)
- Check that the bucket exists in the specified region
- Ensure `AWS_REGION` matches your bucket's region

### Error: "Invalid credentials"
- Double-check your Access Key ID and Secret Access Key
- Ensure there are no extra spaces in your `.env` file
- Verify the credentials are active in AWS IAM

### Files not appearing in S3
- Check server logs for errors
- Verify network connectivity to AWS
- Check S3 bucket permissions

## Security Best Practices

1. **Never commit `.env` file** - It's already in `.gitignore`
2. **Rotate access keys regularly** - Change them every 90 days
3. **Use least privilege** - Only grant necessary S3 permissions
4. **Enable MFA** - For AWS root account
5. **Monitor access** - Use CloudTrail to monitor S3 access
6. **Set up lifecycle policies** - Automatically delete old files if needed

## Cost Optimization

- S3 storage is very cheap (~$0.023 per GB/month)
- Consider setting up lifecycle policies to move old files to Glacier
- Monitor your usage in AWS Cost Explorer

## Support

If you encounter issues:
1. Check server logs: `tail -f logs/all.log`
2. Verify environment variables are loaded correctly
3. Test S3 connection using AWS CLI:
   ```bash
   aws s3 ls s3://your-bucket-name/ --profile your-profile
   ```
