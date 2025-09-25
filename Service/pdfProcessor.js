//eheufheiuofwoenferwonvrwonhveriohnerwion

const pdf = require('pdf-parse');
const natural = require('natural');
const compromise = require('compromise');
const { DiseaseTemplate, MedicalRecord, PDFDocument } = require('../db/db');

class PDFProcessor {
  constructor() {
    this.stemmer = natural.PorterStemmer;
  }

  // Extract text from PDF
  async extractText(pdfBuffer) {
    try {
      const data = await pdf(pdfBuffer);
      return data.text;
    } catch (error) {
      throw new Error('Failed to extract text from PDF');
    }
  }

  // Identify disease from text
  async identifyDisease(text) {
    const templates = await DiseaseTemplate.find();
    const textLower = text.toLowerCase();
    
    let bestMatch = null;
    let highestScore = 0;

    for (const template of templates) {
      let score = 0;
      const totalKeywords = template.keywords.length;
      
      for (const keyword of template.keywords) {
        if (textLower.includes(keyword.toLowerCase())) {
          score++;
        }
      }
      
      const confidence = (score / totalKeywords) * 100;
      
      if (confidence > highestScore && confidence > 30) { // 30% minimum confidence
        highestScore = confidence;
        bestMatch = {
          template,
          confidence
        };
      }
    }

    return bestMatch;
  }

  // Extract data based on template fields
  extractDataFromText(text, template) {
    const extractedData = new Map();
    const doc = compromise(text);
    
    for (const field of template.fields) {
      let value = null;
      
      switch (field.fieldType) {
        case 'text':
          value = this.extractTextField(text, field);
          break;
        case 'number':
          value = this.extractNumberField(text, field);
          break;
        case 'date':
          value = this.extractDateField(text, field);
          break;
        case 'boolean':
          value = this.extractBooleanField(text, field);
          break;
      }
      
      if (value !== null) {
        extractedData.set(field.fieldName, value);
      }
    }
    
    return extractedData;
  }

  // Extract text field
  extractTextField(text, field) {
    if (field.extractionPattern) {
      const regex = new RegExp(field.extractionPattern, 'gi');
      const matches = text.match(regex);
      return matches ? matches[0] : null;
    }
    
    // Look for field name followed by value
    const fieldNameRegex = new RegExp(`${field.fieldName}[:\\s]+([^\n\r]+)`, 'gi');
    const match = text.match(fieldNameRegex);
    return match ? match[1].trim() : null;
  }

  // Extract number field
  extractNumberField(text, field) {
    const pattern = field.extractionPattern || `${field.fieldName}[:\\s]+(\\d+(?:\\.\\d+)?)`;
    const regex = new RegExp(pattern, 'gi');
    const match = text.match(regex);
    
    if (match) {
      const numberMatch = match[0].match(/\d+(?:\.\d+)?/);
      return numberMatch ? parseFloat(numberMatch[0]) : null;
    }
    
    return null;
  }

  // Extract date field
  extractDateField(text, field) {
    const datePatterns = [
      /\d{1,2}\/\d{1,2}\/\d{4}/g,
      /\d{1,2}-\d{1,2}-\d{4}/g,
      /\d{4}-\d{1,2}-\d{1,2}/g
    ];
    
    for (const pattern of datePatterns) {
      const matches = text.match(pattern);
      if (matches) {
        return new Date(matches[0]);
      }
    }
    
    return null;
  }

  // Extract boolean field
  extractBooleanField(text, field) {
    const positiveWords = ['yes', 'positive', 'present', 'true', 'confirmed'];
    const negativeWords = ['no', 'negative', 'absent', 'false', 'denied'];
    
    const textLower = text.toLowerCase();
    const fieldContext = this.getFieldContext(textLower, field.fieldName);
    
    for (const word of positiveWords) {
      if (fieldContext.includes(word)) return true;
    }
    
    for (const word of negativeWords) {
      if (fieldContext.includes(word)) return false;
    }
    
    return null;
  }

  // Get context around field name
  getFieldContext(text, fieldName, contextLength = 50) {
    const index = text.indexOf(fieldName.toLowerCase());
    if (index === -1) return '';
    
    const start = Math.max(0, index - contextLength);
    const end = Math.min(text.length, index + fieldName.length + contextLength);
    
    return text.substring(start, end);
  }

  // Process complete PDF
  async processPDF(pdfId, pdfBuffer, userId) {
    try {
      // Update status to processing
      await PDFDocument.findByIdAndUpdate(pdfId, { 
        processingStatus: 'processing' 
      });

      // Extract text
      const extractedText = await this.extractText(pdfBuffer);
      
      // Update PDF with extracted text
      await PDFDocument.findByIdAndUpdate(pdfId, { 
        extractedText,
        processedAt: new Date()
      });

      // Identify disease
      const diseaseMatch = await this.identifyDisease(extractedText);
      
      if (!diseaseMatch) {
        await PDFDocument.findByIdAndUpdate(pdfId, { 
          processingStatus: 'completed' 
        });
        return {
          success: false,
          message: 'No matching disease template found'
        };
      }

      // Extract data based on template
      const extractedData = this.extractDataFromText(
        extractedText, 
        diseaseMatch.template
      );

      // Create medical record
      const medicalRecord = await MedicalRecord.create({
        pdfDocument: pdfId,
        patient: userId,
        diseaseTemplate: diseaseMatch.template._id,
        diseaseName: diseaseMatch.template.diseaseName,
        extractedData,
        confidence: diseaseMatch.confidence
      });

      // Update PDF status
      await PDFDocument.findByIdAndUpdate(pdfId, { 
        processingStatus: 'completed' 
      });

      return {
        success: true,
        message: 'PDF processed successfully',
        medicalRecord,
        disease: diseaseMatch.template.diseaseName,
        confidence: diseaseMatch.confidence
      };

    } catch (error) {
      await PDFDocument.findByIdAndUpdate(pdfId, { 
        processingStatus: 'failed' 
      });
      
      throw error;
    }
  }
}

module.exports = new PDFProcessor();