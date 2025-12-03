# AWS UK Migration Plan for NHS DTAC Compliance

## Executive Summary

This document provides a detailed migration plan to move Clerky's infrastructure from US-based services (Firebase, Render.com) to AWS UK regions (eu-west-2, London) to achieve NHS DTAC data residency compliance.

## Current Infrastructure Analysis

### Current Services

1. **Backend Hosting**: Render.com (US-based)
   - Node.js/Express server
   - Auto-scaling
   - Health monitoring

2. **Database**: Firebase Firestore (US-based)
   - Collections: `guidelines`, `sessions`, `userPreferences`, `summaries`, `keywords`, `condensed`, `agent_knowledge`
   - Real-time capabilities
   - Authentication integration

3. **File Storage**: Firebase Storage (US-based)
   - PDF guidelines storage
   - File uploads

4. **Authentication**: Firebase Authentication (US-based)
   - JWT tokens
   - User management

5. **Frontend Hosting**: Firebase Hosting / GitHub Pages
   - Static files
   - CDN distribution

6. **AI Services**: Multiple US-based API providers
   - OpenAI, Anthropic, DeepSeek, Mistral, Google Gemini
   - To be replaced with self-hosted open-source LLMs

### Data Flow Analysis

```
User → Frontend (Firebase Hosting)
  ↓
Backend (Render.com) → Firebase Firestore
                    → Firebase Storage
                    → Firebase Auth
                    → AI APIs (US-based)
```

## Target AWS UK Architecture

### Target Services

1. **Backend Hosting**: AWS ECS/EKS or EC2 (UK region: eu-west-2)
2. **Database**: AWS RDS (PostgreSQL) or DynamoDB (UK region: eu-west-2)
3. **File Storage**: AWS S3 (UK region: eu-west-2)
4. **Authentication**: AWS Cognito or maintain Firebase with UK data residency
5. **Frontend Hosting**: AWS S3 + CloudFront (UK edge locations)
6. **AI Services**: Self-hosted LLMs on AWS EC2 GPU instances (UK region: eu-west-2)
7. **CDN**: CloudFront (UK edge locations)

### Target Data Flow

```
User → Frontend (S3 + CloudFront UK)
  ↓
Backend (ECS/EKS UK) → RDS/DynamoDB (UK)
                    → S3 (UK)
                    → Cognito (UK)
                    → Self-hosted LLM (UK GPU instances)
```

## Migration Strategy

### Phase 1: Preparation & Planning (Week 1-2)

#### 1.1 AWS Account Setup
- [ ] Create AWS account (if not exists)
- [ ] Set up billing alerts
- [ ] Configure IAM users and roles
- [ ] Set up AWS Organizations (if needed)
- [ ] Enable CloudTrail for audit logging
- [ ] Configure AWS Config for compliance monitoring

#### 1.2 Architecture Design
- [ ] Design VPC architecture for UK region
- [ ] Plan subnet structure
- [ ] Design security groups
- [ ] Plan database architecture (RDS vs DynamoDB)
- [ ] Design S3 bucket structure
- [ ] Plan authentication migration strategy

#### 1.3 Cost Estimation
- [ ] Estimate ECS/EKS costs
- [ ] Estimate RDS/DynamoDB costs
- [ ] Estimate S3 storage costs
- [ ] Estimate GPU instance costs (for LLMs)
- [ ] Estimate CloudFront costs
- [ ] Compare with current Firebase/Render costs
- [ ] Create AWS Cost Explorer budgets

#### 1.4 Data Inventory
- [ ] Audit all Firestore collections
- [ ] Document data schemas
- [ ] Identify data dependencies
- [ ] List all Firebase Storage files
- [ ] Document authentication user base
- [ ] Create data migration scripts

### Phase 2: AWS Infrastructure Setup (Week 3-4)

#### 2.1 Network Infrastructure
- [ ] Create VPC in eu-west-2
- [ ] Create public and private subnets
- [ ] Set up Internet Gateway
- [ ] Configure NAT Gateway (for private subnets)
- [ ] Set up Route Tables
- [ ] Configure Security Groups
- [ ] Set up VPC Flow Logs

#### 2.2 Database Setup
**Option A: RDS PostgreSQL (Recommended)**
- [ ] Create RDS PostgreSQL instance in private subnet
- [ ] Configure Multi-AZ for high availability
- [ ] Set up automated backups
- [ ] Configure encryption at rest
- [ ] Set up read replicas (if needed)
- [ ] Create database schema
- [ ] Set up connection pooling (PgBouncer)

**Option B: DynamoDB**
- [ ] Create DynamoDB tables
- [ ] Configure Global Tables (if needed)
- [ ] Set up encryption at rest
- [ ] Configure point-in-time recovery
- [ ] Set up auto-scaling

#### 2.3 Storage Setup
- [ ] Create S3 buckets in eu-west-2
- [ ] Configure bucket policies
- [ ] Set up versioning
- [ ] Configure lifecycle policies
- [ ] Set up encryption (SSE-S3 or SSE-KMS)
- [ ] Configure CORS (for frontend)
- [ ] Set up CloudFront distribution for S3

#### 2.4 Authentication Setup
**Option A: AWS Cognito (Recommended)**
- [ ] Create Cognito User Pool
- [ ] Configure authentication flows
- [ ] Set up user attributes
- [ ] Configure password policies
- [ ] Set up MFA (if required)
- [ ] Create identity pool (if needed)
- [ ] Migrate user data (if possible)

**Option B: Firebase with UK Data Residency**
- [ ] Check if Firebase offers UK data residency
- [ ] Configure Firebase project for UK region
- [ ] Verify data residency compliance
- [ ] Update Firebase configuration

#### 2.5 Compute Infrastructure
- [ ] Create ECS cluster or EKS cluster
- [ ] Set up EC2 launch templates
- [ ] Configure auto-scaling groups
- [ ] Set up Application Load Balancer
- [ ] Configure health checks
- [ ] Set up CloudWatch monitoring

#### 2.6 GPU Infrastructure (for LLMs)
- [ ] Create GPU instance (g4dn.xlarge or larger)
- [ ] Set up NVIDIA drivers
- [ ] Install CUDA toolkit
- [ ] Deploy LLM inference server (vLLM)
- [ ] Configure model storage (S3)
- [ ] Set up model loading pipeline
- [ ] Configure auto-scaling for GPU instances

### Phase 3: Application Migration (Week 5-7)

#### 3.1 Backend Code Updates
- [ ] Update database connection code
  - Replace Firestore SDK with PostgreSQL/DynamoDB SDK
  - Update query syntax
  - Update data models
- [ ] Update file storage code
  - Replace Firebase Storage with S3 SDK
  - Update file upload/download logic
  - Update file URLs
- [ ] Update authentication code
  - Replace Firebase Auth with Cognito SDK (if migrating)
  - Update JWT validation
  - Update user management
- [ ] Update AI integration
  - Replace API calls with local LLM API
  - Update prompt formatting
  - Update response handling
- [ ] Update environment variables
- [ ] Update configuration files

#### 3.2 Database Migration
- [ ] Create database schema
- [ ] Write data export script from Firestore
- [ ] Write data import script to RDS/DynamoDB
- [ ] Test data migration on staging
- [ ] Validate data integrity
- [ ] Perform full data migration
- [ ] Verify data completeness

#### 3.3 File Storage Migration
- [ ] List all files in Firebase Storage
- [ ] Download all files
- [ ] Upload to S3 with same structure
- [ ] Update file URLs in database
- [ ] Verify file accessibility
- [ ] Set up S3 lifecycle policies

#### 3.4 Frontend Updates
- [ ] Update API endpoints (point to AWS backend)
- [ ] Update authentication SDK (if using Cognito)
- [ ] Update file URLs (S3/CloudFront)
- [ ] Update Firebase configuration (if keeping Firebase Auth)
- [ ] Test all frontend functionality

#### 3.5 LLM Integration
- [ ] Deploy BioMistral or selected model
- [ ] Create API wrapper for LLM
- [ ] Update `sendToAI` function
- [ ] Implement fallback mechanism
- [ ] Test LLM performance
- [ ] Optimize inference speed
- [ ] Set up monitoring

### Phase 4: Testing & Validation (Week 8)

#### 4.1 Functional Testing
- [ ] Test all API endpoints
- [ ] Test authentication flows
- [ ] Test file uploads/downloads
- [ ] Test database operations
- [ ] Test LLM inference
- [ ] Test frontend functionality
- [ ] Test error handling

#### 4.2 Performance Testing
- [ ] Load testing
- [ ] Stress testing
- [ ] Latency testing
- [ ] Throughput testing
- [ ] Database performance testing
- [ ] LLM inference latency testing

#### 4.3 Security Testing
- [ ] Security group validation
- [ ] Encryption verification
- [ ] Access control testing
- [ ] Penetration testing (if required)
- [ ] Vulnerability scanning

#### 4.4 Data Residency Validation
- [ ] Verify all data in UK region
- [ ] Verify no data leaves UK
- [ ] Document data locations
- [ ] Create data residency certificate
- [ ] Update DPIA with new architecture

### Phase 5: Deployment & Cutover (Week 9)

#### 5.1 Staging Deployment
- [ ] Deploy to staging environment
- [ ] Perform full system test
- [ ] User acceptance testing
- [ ] Fix any issues
- [ ] Performance optimization

#### 5.2 Production Deployment Strategy
**Option A: Blue-Green Deployment (Recommended)**
- [ ] Deploy new system alongside old
- [ ] Route test traffic to new system
- [ ] Gradually increase traffic
- [ ] Monitor for issues
- [ ] Complete cutover

**Option B: Big Bang Cutover**
- [ ] Schedule maintenance window
- [ ] Deploy new system
- [ ] Switch DNS/routing
- [ ] Monitor closely
- [ ] Rollback plan ready

#### 5.3 DNS & Routing Updates
- [ ] Update DNS records
- [ ] Update CloudFront distribution
- [ ] Update API endpoints
- [ ] Configure health checks
- [ ] Set up monitoring alerts

#### 5.4 Data Synchronization
- [ ] Final data sync from Firestore
- [ ] Final file sync from Firebase Storage
- [ ] Verify data completeness
- [ ] Set up read-only access to old system (for reference)

### Phase 6: Post-Migration (Week 10+)

#### 6.1 Monitoring & Optimization
- [ ] Set up CloudWatch dashboards
- [ ] Configure alarms
- [ ] Monitor costs
- [ ] Optimize resource usage
- [ ] Fine-tune auto-scaling
- [ ] Optimize database queries
- [ ] Optimize LLM inference

#### 6.2 Documentation
- [ ] Update architecture diagrams
- [ ] Document new infrastructure
- [ ] Update runbooks
- [ ] Document operational procedures
- [ ] Update disaster recovery plan
- [ ] Update security documentation

#### 6.3 Decommissioning
- [ ] Keep old system running for 30 days (backup)
- [ ] Export final data snapshots
- [ ] Decommission Render.com instance
- [ ] Archive Firebase data (if not keeping)
- [ ] Update documentation

## Detailed Migration Steps

### Database Migration: Firestore to RDS PostgreSQL

#### Schema Mapping

**Firestore Collections → PostgreSQL Tables**:

1. **guidelines** → `guidelines`
   - Firestore document ID → `id` (VARCHAR PRIMARY KEY)
   - Firestore fields → PostgreSQL columns
   - Timestamps → TIMESTAMP

2. **sessions** → `sessions`
   - Similar mapping

3. **userPreferences** → `user_preferences`
   - Similar mapping

4. **summaries** → `summaries`
   - Similar mapping

5. **keywords** → `keywords`
   - Similar mapping

6. **condensed** → `condensed_guidelines`
   - Similar mapping

7. **agent_knowledge** → `agent_knowledge`
   - Similar mapping

#### Migration Script Example

```javascript
// Export from Firestore
const admin = require('firebase-admin');
const { Pool } = require('pg');

async function migrateFirestoreToPostgreSQL() {
  const db = admin.firestore();
  const pool = new Pool({
    host: process.env.RDS_HOST,
    database: process.env.RDS_DATABASE,
    user: process.env.RDS_USER,
    password: process.env.RDS_PASSWORD,
    port: 5432,
    ssl: { rejectUnauthorized: false }
  });

  // Migrate guidelines
  const guidelinesSnapshot = await db.collection('guidelines').get();
  for (const doc of guidelinesSnapshot.docs) {
    const data = doc.data();
    await pool.query(
      `INSERT INTO guidelines (id, filename, content, condensed, ...) 
       VALUES ($1, $2, $3, $4, ...) 
       ON CONFLICT (id) DO UPDATE SET ...`,
      [doc.id, data.filename, data.content, data.condensed, ...]
    );
  }

  // Repeat for other collections...
}
```

### File Storage Migration: Firebase Storage to S3

#### Migration Script Example

```javascript
const admin = require('firebase-admin');
const AWS = require('aws-sdk');

const s3 = new AWS.S3({ region: 'eu-west-2' });

async function migrateFilesToS3() {
  const bucket = admin.storage().bucket('clerky-b3be8.firebasestorage.app');
  const [files] = await bucket.getFiles({ prefix: 'pdfs/' });

  for (const file of files) {
    const [buffer] = await file.download();
    await s3.putObject({
      Bucket: 'clerky-uk-storage',
      Key: file.name,
      Body: buffer,
      ContentType: file.metadata.contentType
    }).promise();
    console.log(`Migrated: ${file.name}`);
  }
}
```

### Authentication Migration: Firebase Auth to Cognito

#### Migration Strategy

1. **Export Users from Firebase**:
   - Use Firebase Admin SDK to export users
   - Export user attributes, passwords (hashed), metadata

2. **Import to Cognito**:
   - Use Cognito Admin APIs
   - Import users with temporary passwords
   - Force password reset on first login
   - Migrate custom attributes

3. **Update Frontend**:
   - Replace Firebase Auth SDK with AWS Amplify or Cognito SDK
   - Update authentication flows
   - Update token handling

#### Alternative: Keep Firebase Auth

If Firebase offers UK data residency:
- Verify UK data residency
- Update Firebase project configuration
- No code changes needed (easiest option)

### LLM Deployment on AWS GPU

#### Step-by-Step Deployment

1. **Launch GPU Instance**:
   ```bash
   # Launch g4dn.xlarge in eu-west-2
   aws ec2 run-instances \
     --image-id ami-xxx \
     --instance-type g4dn.xlarge \
     --subnet-id subnet-xxx \
     --security-group-ids sg-xxx \
     --region eu-west-2
   ```

2. **Install Dependencies**:
   ```bash
   # Install NVIDIA drivers
   # Install CUDA
   # Install Docker with NVIDIA runtime
   # Install vLLM
   ```

3. **Deploy Model**:
   ```bash
   # Download model from Hugging Face
   # Load into vLLM
   # Start inference server
   ```

4. **Create API Wrapper**:
   ```javascript
   // Update sendToAI function to call local LLM
   async function sendToAI(prompt, model, systemPrompt, userId, temperature) {
     const response = await axios.post('http://localhost:8000/v1/chat/completions', {
       model: 'biomistral-7b',
       messages: [...],
       temperature: temperature
     });
     return response.data;
   }
   ```

## Cost Analysis

### Current Costs (Estimated)

- **Render.com**: ~$25-50/month (backend hosting)
- **Firebase**: ~$0-25/month (free tier + usage)
- **AI APIs**: Variable based on usage
  - At 100M tokens/month: ~$50-300/month
  - At 1B tokens/month: ~$500-3000/month

### AWS UK Costs (Estimated)

#### Infrastructure
- **ECS/EKS**: ~£30-50/month (small cluster)
- **RDS PostgreSQL** (db.t3.medium): ~£60-80/month
- **S3 Storage** (100GB): ~£2-3/month
- **CloudFront**: ~£5-10/month (low traffic)
- **Cognito**: ~£0-5/month (low user count)

#### GPU Instances (LLM)
- **g4dn.xlarge** (24/7): ~£400/month
- **g4dn.2xlarge** (24/7): ~£600/month
- **g5.xlarge** (24/7): ~£730/month

#### Total Estimated Monthly Cost
- **Infrastructure**: ~£100-150/month
- **GPU (LLM)**: ~£400-730/month
- **Total**: ~£500-880/month

#### Cost Comparison
- **Current (low usage)**: ~£50-100/month
- **Current (high usage)**: ~£500-3000/month
- **AWS UK (self-hosted)**: ~£500-880/month (fixed)

**Break-even**: At ~800M-1B tokens/month, self-hosted becomes cost-effective.

**Advantages of AWS UK**:
- Predictable costs
- No per-token charges
- Data residency compliance
- Full control

## Risk Mitigation

### Technical Risks

1. **Data Loss During Migration**
   - **Mitigation**: Full backups before migration, test migration on staging, keep old system running during transition

2. **Downtime During Cutover**
   - **Mitigation**: Blue-green deployment, gradual traffic migration, rollback plan

3. **Performance Issues**
   - **Mitigation**: Load testing, performance monitoring, auto-scaling

4. **LLM Performance Lower Than APIs**
   - **Mitigation**: Keep API providers as fallback, A/B testing, gradual rollout

### Operational Risks

1. **Increased Complexity**
   - **Mitigation**: Comprehensive documentation, training, monitoring

2. **Higher Costs**
   - **Mitigation**: Cost monitoring, optimization, right-sizing instances

3. **Skills Gap**
   - **Mitigation**: Training, AWS support, documentation

## Timeline Summary

| Phase | Duration | Key Activities |
|-------|----------|---------------|
| **Phase 1: Preparation** | 2 weeks | Planning, AWS setup, cost estimation |
| **Phase 2: Infrastructure** | 2 weeks | AWS services setup, network, database |
| **Phase 3: Application** | 3 weeks | Code updates, data migration, LLM deployment |
| **Phase 4: Testing** | 1 week | Functional, performance, security testing |
| **Phase 5: Deployment** | 1 week | Staging, production cutover |
| **Phase 6: Post-Migration** | Ongoing | Monitoring, optimization, decommissioning |
| **Total** | **9-10 weeks** | Full migration timeline |

## Success Criteria

- [ ] All data migrated successfully
- [ ] All functionality working
- [ ] Performance meets or exceeds current system
- [ ] Data residency verified (all data in UK)
- [ ] Costs within budget
- [ ] Zero data loss
- [ ] Minimal downtime (< 1 hour)
- [ ] All security controls in place
- [ ] Documentation complete
- [ ] Team trained on new infrastructure

## Next Steps

1. **Immediate** (This Week):
   - Review and approve migration plan
   - Set up AWS account
   - Begin Phase 1 activities

2. **Short-term** (Next 2 Weeks):
   - Complete infrastructure design
   - Set up AWS services
   - Begin code updates

3. **Medium-term** (Next 2 Months):
   - Complete migration
   - Testing and validation
   - Production deployment

## References

- AWS UK Regions: https://aws.amazon.com/about-aws/global-infrastructure/regions_az/
- AWS Well-Architected Framework: https://aws.amazon.com/architecture/well-architected/
- NHS DTAC Requirements: https://transform.england.nhs.uk/key-tools-and-info/digital-technology-assessment-criteria-dtac/
- RDS PostgreSQL: https://aws.amazon.com/rds/postgresql/
- ECS: https://aws.amazon.com/ecs/
- S3: https://aws.amazon.com/s3/
- Cognito: https://aws.amazon.com/cognito/



