# Open-Source LLM Research for Clinical Text Processing

## Executive Summary

This document evaluates open-source Large Language Models (LLMs) suitable for deployment on AWS UK infrastructure to meet NHS DTAC compliance requirements. The focus is on models that can process clinical text, provide clinical decision support, and operate entirely within UK data residency.

## Current System Analysis

### Current AI Providers
Clerky currently uses the following API-based providers (in cost order):
1. **DeepSeek** - `deepseek-chat` - $0.0005/1k tokens
2. **Mistral** - `mistral-large-latest` - $0.001/1k tokens
3. **Anthropic** - `claude-3-sonnet-20240229` - $0.003/1k tokens
4. **OpenAI** - `gpt-3.5-turbo` - $0.0015/1k tokens
5. **Gemini** - `gemini-1.5-pro-latest` - $0.0025/1k tokens

### Current Use Cases
- Clinical transcript analysis against guidelines
- Guideline summarization and extraction
- Clinical note generation
- Audit scenario generation
- Guideline discovery and matching

## Recommended Open-Source Models

### 1. BioMistral (Recommended Primary)

**Overview**: Open-source LLM specifically tailored for biomedical domain, built on Mistral foundation model and pre-trained on PubMed Central.

**Key Features**:
- **Base Model**: Mistral 7B
- **Domain**: Biomedical/clinical text
- **Training**: Pre-trained on PubMed Central (biomedical literature)
- **License**: Apache 2.0 (commercial use allowed)
- **Size**: 7B parameters (manageable for AWS GPU instances)

**Performance**:
- Superior performance compared to other open-source medical models
- Strong performance on medical question answering
- Good clinical reasoning capabilities
- Handles medical terminology well

**Advantages for Clerky**:
- ✅ Specifically trained on biomedical/clinical literature
- ✅ Apache 2.0 license allows commercial use
- ✅ 7B parameters = reasonable GPU requirements
- ✅ Based on Mistral (proven architecture)
- ✅ Good balance of performance and resource requirements

**Resource Requirements**:
- **GPU Memory**: ~14GB VRAM (fits on g4dn.xlarge with 16GB)
- **Model Size**: ~14GB (quantized versions available)
- **Inference Speed**: Good latency for real-time use
- **Cost**: Self-hosted = no per-token costs

**Deployment Considerations**:
- Can be deployed using vLLM or similar inference servers
- Supports quantization (4-bit, 8-bit) for reduced memory
- Compatible with Hugging Face Transformers
- Can be fine-tuned further on clinical guidelines if needed

**GitHub**: Available on Hugging Face Model Hub

---

### 2. Clinical Camel

**Overview**: Expert-level medical LLM fine-tuned from LLaMA-2 using QLoRA (Quantized Low-Rank Adaptation).

**Key Features**:
- **Base Model**: LLaMA-2
- **Domain**: Clinical/medical
- **Training Method**: QLoRA fine-tuning
- **License**: LLaMA-2 license (requires Meta approval for commercial use)
- **Size**: 7B or 13B parameters

**Performance**:
- State-of-the-art performance on medical benchmarks
- Capable of synthesizing plausible clinical notes
- Strong clinical reasoning
- Good performance on medical question answering

**Advantages for Clerky**:
- ✅ Excellent clinical performance
- ✅ Proven on medical benchmarks
- ✅ Can generate clinical notes (matches Clerky use case)

**Disadvantages**:
- ⚠️ LLaMA-2 license requires Meta approval for commercial use
- ⚠️ May need larger GPU instances for 13B version

**Resource Requirements**:
- **7B Version**: ~14GB VRAM
- **13B Version**: ~26GB VRAM (requires g4dn.2xlarge or larger)
- **Model Size**: 7B = ~14GB, 13B = ~26GB

**Deployment Considerations**:
- QLoRA allows efficient fine-tuning
- Can be further fine-tuned on NHS guidelines
- Requires Meta license approval for commercial deployment

---

### 3. Me LLaMA

**Overview**: Family of medical LLMs based on LLaMA models, optimized for medical text analysis and diagnosis.

**Key Features**:
- **Base Model**: LLaMA (various sizes)
- **Domain**: Medical text analysis and diagnosis
- **Training**: Optimized for medical tasks
- **License**: LLaMA license (requires Meta approval)
- **Size**: Multiple sizes available

**Performance**:
- Outperforms other open-source medical LLMs
- Strong on medical text analysis tasks
- Good diagnostic reasoning capabilities

**Advantages for Clerky**:
- ✅ Strong medical text analysis (matches guideline analysis use case)
- ✅ Multiple model sizes available
- ✅ Proven performance

**Disadvantages**:
- ⚠️ LLaMA license requires Meta approval
- ⚠️ May need to evaluate different sizes for optimal performance

---

### 4. Mistral 7B/8x7B (Foundation Model)

**Overview**: High-performance open-source foundation model, not specifically medical but very capable.

**Key Features**:
- **License**: Apache 2.0 (commercial use allowed)
- **Size**: 7B or 8x7B (mixture of experts)
- **Performance**: Excellent general performance
- **Training**: General domain, but very capable

**Advantages for Clerky**:
- ✅ Apache 2.0 license (no approval needed)
- ✅ Excellent general performance
- ✅ Can be fine-tuned on clinical data
- ✅ 7B version fits on g4dn.xlarge
- ✅ 8x7B version available for higher performance

**Disadvantages**:
- ⚠️ Not pre-trained on medical data (would need fine-tuning)
- ⚠️ May require more prompt engineering for clinical tasks

**Fine-Tuning Strategy**:
- Fine-tune on NHS guidelines
- Fine-tune on clinical transcripts
- Use RAG (Retrieval Augmented Generation) with guideline database

---

### 5. Llama 2/3 (Foundation Model)

**Overview**: Meta's open-source LLM, very capable but requires license approval.

**Key Features**:
- **License**: Custom Meta license (requires approval for commercial use)
- **Size**: 7B, 13B, 70B available
- **Performance**: Excellent general performance
- **Training**: General domain

**Advantages**:
- ✅ Excellent performance
- ✅ Multiple sizes available
- ✅ Can be fine-tuned

**Disadvantages**:
- ⚠️ License requires Meta approval
- ⚠️ Not medical-specific
- ⚠️ Would need significant fine-tuning

---

## Model Comparison Matrix

| Model | License | Medical Pre-trained | Size | GPU Memory | Performance | Commercial Use |
|-------|---------|-------------------|------|------------|-------------|---------------|
| **BioMistral** | ✅ Apache 2.0 | ✅ Yes (PubMed) | 7B | ~14GB | Excellent | ✅ No approval |
| **Clinical Camel** | ⚠️ LLaMA-2 | ✅ Yes | 7B/13B | 14-26GB | Excellent | ⚠️ Meta approval |
| **Me LLaMA** | ⚠️ LLaMA | ✅ Yes | Various | Varies | Excellent | ⚠️ Meta approval |
| **Mistral 7B** | ✅ Apache 2.0 | ❌ No | 7B | ~14GB | Very Good | ✅ No approval |
| **Mistral 8x7B** | ✅ Apache 2.0 | ❌ No | 8x7B | ~45GB | Excellent | ✅ No approval |
| **Llama 2/3** | ⚠️ Meta License | ❌ No | 7B-70B | Varies | Excellent | ⚠️ Meta approval |

## Recommended Approach for Clerky

### Primary Recommendation: BioMistral 7B

**Rationale**:
1. **License**: Apache 2.0 - no approval needed, immediate commercial use
2. **Medical Domain**: Pre-trained on PubMed Central - understands medical terminology
3. **Size**: 7B parameters - fits on cost-effective AWS GPU instances
4. **Performance**: Excellent on medical tasks
5. **Deployment**: Straightforward with Hugging Face and vLLM

**Deployment Strategy**:
- Deploy BioMistral 7B as primary model
- Use 4-bit quantization to reduce memory to ~8GB (fits on g4dn.xlarge)
- Implement vLLM for efficient inference
- Fine-tune on NHS guidelines if needed (optional Phase 2)

### Secondary Option: Mistral 7B with Fine-Tuning

**If BioMistral doesn't meet performance requirements**:
- Start with Mistral 7B (Apache 2.0 license)
- Fine-tune on NHS clinical guidelines
- Fine-tune on clinical transcripts
- Use RAG with guideline database for context

### Fallback Option: Clinical Camel (if license approved)

**If Meta approves LLaMA-2 commercial use**:
- Clinical Camel offers excellent clinical performance
- Can use 7B or 13B version based on GPU budget
- Proven performance on medical benchmarks

## AWS GPU Instance Recommendations

### Option 1: Cost-Effective (Recommended for Start)
**Instance**: `g4dn.xlarge`
- **GPU**: 1x NVIDIA T4 (16GB VRAM)
- **vCPU**: 4
- **Memory**: 16GB RAM
- **Cost**: ~£0.50-0.70/hour (~£360-500/month if 24/7)
- **Suitable For**: BioMistral 7B (quantized), Mistral 7B (quantized)

### Option 2: Balanced Performance
**Instance**: `g4dn.2xlarge`
- **GPU**: 1x NVIDIA T4 (16GB VRAM)
- **vCPU**: 8
- **Memory**: 32GB RAM
- **Cost**: ~£0.80-1.00/hour (~£580-730/month if 24/7)
- **Suitable For**: BioMistral 7B (full precision), Clinical Camel 7B

### Option 3: High Performance
**Instance**: `g5.xlarge`
- **GPU**: 1x NVIDIA A10G (24GB VRAM)
- **vCPU**: 4
- **Memory**: 16GB RAM
- **Cost**: ~£1.00-1.20/hour (~£730-880/month if 24/7)
- **Suitable For**: Larger models, higher throughput

### Option 4: Maximum Performance
**Instance**: `g5.2xlarge`
- **GPU**: 1x NVIDIA A10G (24GB VRAM)
- **vCPU**: 8
- **Memory**: 32GB RAM
- **Cost**: ~£1.50-1.80/hour (~£1,100-1,300/month if 24/7)
- **Suitable For**: Clinical Camel 13B, high-concurrency scenarios

### Cost Comparison with Current API Costs

**Current API Costs** (estimated):
- DeepSeek: $0.0005/1k tokens
- At 1M tokens/month: ~$0.50/month
- At 100M tokens/month: ~$50/month
- At 1B tokens/month: ~$500/month

**Self-Hosted Costs**:
- g4dn.xlarge (24/7): ~£400/month
- **Break-even**: ~800M-1B tokens/month
- **Advantage**: Predictable costs, no per-token charges
- **Additional Benefits**: Data residency, no API rate limits, full control

**Recommendation**: Start with `g4dn.xlarge` for development/testing, scale up based on usage.

## Deployment Architecture

### Recommended Stack

1. **Inference Server**: vLLM or Text Generation Inference (TGI)
   - Efficient batching and serving
   - Supports quantization
   - Good performance

2. **Container**: Docker with NVIDIA runtime
   - Easy deployment
   - Reproducible
   - Compatible with AWS ECS/EKS

3. **API Layer**: FastAPI or Express.js
   - REST API compatible with current Clerky backend
   - Minimal code changes needed
   - Can maintain current API structure

4. **Model Storage**: AWS S3 (UK region)
   - Store model weights
   - Version control
   - Easy updates

5. **Monitoring**: CloudWatch
   - GPU utilization
   - Inference latency
   - Error tracking

## Implementation Plan

### Phase 1: Proof of Concept (Week 1-2)
1. Set up AWS g4dn.xlarge instance in UK region
2. Deploy BioMistral 7B using vLLM
3. Test with sample clinical transcripts
4. Compare output quality with current API providers
5. Measure latency and throughput

### Phase 2: Integration (Week 3-4)
1. Create API wrapper compatible with current `sendToAI` function
2. Integrate with Clerky backend
3. Implement fallback mechanism (keep API providers as backup)
4. Load testing and performance optimization

### Phase 3: Production Deployment (Week 5-6)
1. Deploy to production AWS infrastructure
2. Set up auto-scaling if needed
3. Implement monitoring and alerting
4. Document deployment and operations procedures

### Phase 4: Optimization (Ongoing)
1. Fine-tune on NHS guidelines (optional)
2. Implement caching for common queries
3. Optimize batch processing
4. Consider model quantization for cost reduction

## Fine-Tuning Strategy (Optional)

If initial performance needs improvement:

1. **Dataset Preparation**:
   - NHS clinical guidelines (already have)
   - Clinical transcripts (anonymized)
   - Clinical notes examples
   - Medical Q&A pairs

2. **Fine-Tuning Method**:
   - LoRA (Low-Rank Adaptation) for efficiency
   - QLoRA for quantized fine-tuning
   - Focus on clinical decision support tasks

3. **Evaluation**:
   - Compare with current API provider outputs
   - Clinical expert review
   - Automated metrics (BLEU, ROUGE, medical accuracy)

## Risk Mitigation

### Performance Risks
- **Risk**: Model performance lower than API providers
- **Mitigation**: Keep API providers as fallback, A/B testing, gradual rollout

### Resource Risks
- **Risk**: GPU instance costs higher than expected
- **Mitigation**: Start with smaller instance, use quantization, implement auto-scaling

### Deployment Risks
- **Risk**: Deployment complexity or downtime
- **Mitigation**: Phased rollout, maintain API fallback, comprehensive testing

## Next Steps

1. **Immediate** (This Week):
   - Set up AWS UK account and g4dn.xlarge instance
   - Download and test BioMistral 7B locally or on AWS
   - Run sample clinical transcripts through model
   - Compare outputs with current API providers

2. **Short-term** (Next 2 Weeks):
   - Deploy vLLM inference server
   - Create API wrapper
   - Integrate with Clerky backend
   - Begin load testing

3. **Medium-term** (Next Month):
   - Production deployment
   - Performance optimization
   - Documentation
   - Consider fine-tuning if needed

## References

- BioMistral: https://huggingface.co/BioMistral/BioMistral-7B
- Clinical Camel: https://huggingface.co/WisdomShell/ClinicalCamel-70B (various sizes)
- Me LLaMA: Research papers and Hugging Face
- Mistral: https://mistral.ai/
- vLLM: https://github.com/vllm-project/vllm
- AWS GPU Instances: https://aws.amazon.com/ec2/instance-types/g4/

