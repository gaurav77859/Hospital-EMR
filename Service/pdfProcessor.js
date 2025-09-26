const pdf = require('pdf-parse');
const natural = require('natural');
const compromise = require('compromise');
const Tesseract = require('tesseract.js');
const pdf2pic = require('pdf2pic');
const fs = require('fs-extra');
const path = require('path');
const { DiseaseTemplate, MedicalRecord, PDFDocument } = require('../db/db');

class PDFProcessor {
  constructor() {
    this.stemmer = natural.PorterStemmer;
  }

  // Check if PDF contains text or is image-based
  async checkPDFType(pdfBuffer) {
    try {
      const data = await pdf(pdfBuffer);
      const extractedText = data.text.trim();
      
      // If extracted text is very short or empty, it's likely an image-based PDF
      if (extractedText.length < 50) {
        return {
          type: 'image',
          text: extractedText,
          pages: data.numpages
        };
      } else {
        return {
          type: 'text',
          text: extractedText,
          pages: data.numpages
        };
      }
    } catch (error) {
      throw new Error('Failed to analyze PDF type');
    }
  }

  // Extract text from image-based PDF using OCR
  async extractTextFromImagePDF(pdfPath) {
    try {
      console.log('Processing image-based PDF with OCR...');
      
      // Convert PDF pages to images
      const convert = pdf2pic.fromPath(pdfPath, {
        density: 300,           // Higher density = better quality
        saveFilename: "page",
        savePath: path.join(path.dirname(pdfPath), 'temp_images'),
        format: "png",
        width: 2000,
        height: 2000
      });

      // Get PDF info to know number of pages
      const pdfBuffer = await fs.readFile(pdfPath);
      const pdfData = await pdf(pdfBuffer);
      const totalPages = pdfData.numpages;

      let allExtractedText = '';

      // Process each page
      for (let pageNum = 1; pageNum <= Math.min(totalPages, 10); pageNum++) { // Limit to 10 pages max
        try {
          console.log(`Processing page ${pageNum}/${totalPages}...`);
          
          // Convert page to image
          const result = await convert(pageNum, { responseType: "buffer" });
          
          if (result && result.buffer) {
            // Run OCR on the image
            const ocrResult = await Tesseract.recognize(result.buffer, 'eng', {
              logger: m => {
                if (m.status === 'recognizing text') {
                  console.log(`OCR Progress: ${Math.round(m.progress * 100)}%`);
                }
              }
            });

            if (ocrResult && ocrResult.data && ocrResult.data.text) {
              allExtractedText += `\n--- Page ${pageNum} ---\n${ocrResult.data.text}\n`;
              console.log(`Page ${pageNum} OCR completed. Text length: ${ocrResult.data.text.length}`);
            }
          }
        } catch (pageError) {
          console.error(`Error processing page ${pageNum}:`, pageError.message);
          continue; // Skip this page and continue with others
        }
      }

      // Clean up temporary images
      const tempDir = path.join(path.dirname(pdfPath), 'temp_images');
      if (await fs.pathExists(tempDir)) {
        await fs.remove(tempDir);
      }

      if (allExtractedText.trim().length === 0) {
        throw new Error('No text could be extracted from images');
      }

      console.log(`OCR completed. Total extracted text length: ${allExtractedText.length}`);
      return allExtractedText.trim();

    } catch (error) {
      console.error('OCR extraction failed:', error);
      throw new Error(`OCR processing failed: ${error.message}`);
    }
  }

  // Enhanced text extraction (handles both text and image PDFs)
  async extractText(pdfBuffer, pdfPath) {
    try {
      // First, check what type of PDF we're dealing with
      const pdfInfo = await this.checkPDFType(pdfBuffer);
      
      console.log(`PDF Type: ${pdfInfo.type}, Pages: ${pdfInfo.pages}, Text Length: ${pdfInfo.text.length}`);

      if (pdfInfo.type === 'text' && pdfInfo.text.length > 50) {
        // Text-based PDF - use existing method
        console.log('Using text extraction method');
        return pdfInfo.text;
      } else {
        // Image-based PDF - use OCR
        console.log('Using OCR extraction method');
        return await this.extractTextFromImagePDF(pdfPath);
      }
    } catch (error) {
      console.error('Text extraction failed:', error);
      throw new Error(`Failed to extract text: ${error.message}`);
    }
  }

  // Clean and preprocess extracted text
  cleanExtractedText(text) {
    return text
      .replace(/\s+/g, ' ')           // Replace multiple spaces with single space
      .replace(/\n\s*\n/g, '\n')      // Remove empty lines
      .replace(/[^\w\s\n\r.,;:()\-]/g, '') // Remove special characters except basic punctuation
      .trim();
  }

  // Identify disease from text with improved matching
  async identifyDisease(text) {
    const templates = await DiseaseTemplate.find();
    const textLower = this.cleanExtractedText(text).toLowerCase();
    
    console.log(`Analyzing text for disease identification. Text length: ${textLower.length}`);
    
    let bestMatch = null;
    let highestScore = 0;

    for (const template of templates) {
      let score = 0;
      let keywordMatches = [];
      const totalKeywords = template.keywords.length;
      
      for (const keyword of template.keywords) {
        const keywordLower = keyword.toLowerCase();
        const regex = new RegExp(`\\b${keywordLower.replace(/[.*+?^${}()|[```\```/g, '\\$&')}\\b`, 'gi');
        const matches = textLower.match(regex);
        
        if (matches) {
          score += matches.length; // Count multiple occurrences
          keywordMatches.push({
            keyword: keyword,
            count: matches.length
          });
        }
      }
      
      // Calculate confidence with weighted scoring
      const baseConfidence = (score / totalKeywords) * 100;
      const bonusConfidence = Math.min(score * 5, 30); // Bonus for multiple keyword matches
      const confidence = Math.min(baseConfidence + bonusConfidence, 100);
      
      console.log(`Template: ${template.diseaseName}, Score: ${score}/${totalKeywords}, Confidence: ${confidence.toFixed(1)}%`);
      
      if (confidence > highestScore && confidence > 25) { // Lowered threshold for OCR text
        highestScore = confidence;
        bestMatch = {
          template,
          confidence,
          keywordMatches
        };
      }
    }

    if (bestMatch) {
      console.log(`Best match: ${bestMatch.template.diseaseName} (${bestMatch.confidence.toFixed(1)}% confidence)`);
    } else {
      console.log('No disease template matched with sufficient confidence');
    }

    return bestMatch;
  }

  // Enhanced data extraction with better pattern matching
  extractDataFromText(text, template) {
    const extractedData = new Map();
    const cleanText = this.cleanExtractedText(text);
    
    console.log(`Extracting data for ${template.diseaseName} template`);
    
    for (const field of template.fields) {
      let value = null;
      
      try {
        switch (field.fieldType) {
          case 'text':
            value = this.extractTextField(cleanText, field);
            break;
          case 'number':
            value = this.extractNumberField(cleanText, field);
            break;
          case 'date':
            value = this.extractDateField(cleanText, field);
            break;
          case 'boolean':
            value = this.extractBooleanField(cleanText, field);
            break;
        }
        
        if (value !== null) {
          extractedData.set(field.fieldName, value);
          console.log(`Extracted ${field.fieldName}: ${value}`);
        } else {
          console.log(`Could not extract ${field.fieldName}`);
        }
      } catch (error) {
        console.error(`Error extracting ${field.fieldName}:`, error.message);
      }
    }
    
    return extractedData;
  }

  // Enhanced text field extraction
  extractTextField(text, field) {
    const patterns = [
      field.extractionPattern,
      `${field.fieldName}[:\\s]+([^\n\r]+)`,
      `${field.fieldName.replace(/_/g, ' ')}[:\\s]+([^\n\r]+)`,
      `${field.fieldName.replace(/_/g, '\\s*')}[:\\s]+([^\n\r]+)`
    ].filter(Boolean);

    for (const pattern of patterns) {
      try {
        const regex = new RegExp(pattern, 'gi');
        const match = text.match(regex);
        if (match && match.length > 0) {
          // Extract the captured group or clean the full match
          const result = match[0].replace(new RegExp(`^${field.fieldName.replace(/_/g, '\\s*')}[:\\s]+`, 'gi'), '').trim();
          if (result && result.length > 0) {
            return result;
          }
        }
      } catch (error) {
        continue;
      }
    }
    
    return null;
  }

  // Enhanced number extraction
  extractNumberField(text, field) {
    const patterns = [
      field.extractionPattern,
      `${field.fieldName}[:\\s]+(\\d+(?:\\.\\d+)?)`,
      `${field.fieldName.replace(/_/g, ' ')}[:\\s]+(\\d+(?:\\.\\d+)?)`,
      `${field.fieldName.replace(/_/g, '\\s*')}[:\\s]+(\\d+(?:\\.\\d+)?)`
    ].filter(Boolean);

    for (const pattern of patterns) {
      try {
        const regex = new RegExp(pattern, 'gi');
        const match = text.match(regex);
        
        if (match) {
          const numberMatch = match[0].match(/\d+(?:\.\d+)?/);
          if (numberMatch) {
            return parseFloat(numberMatch[0]);
          }
        }
      } catch (error) {
        continue;
      }
    }
    
    return null;
  }

  // Enhanced date extraction
  extractDateField(text, field) {
    const datePatterns = [
      /\d{1,2}\/\d{1,2}\/\d{4}/g,
      /\d{1,2}-\d{1,2}-\d{4}/g,
      /\d{4}-\d{1,2}-\d{1,2}/g,
      /\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{4}/gi
    ];
    
    for (const pattern of datePatterns) {
      const matches = text.match(pattern);
      if (matches) {
        try {
          return new Date(matches[0]);
        } catch (error) {
          continue;
        }
      }
    }
    
    return null;
  }

  // Enhanced boolean extraction
  extractBooleanField(text, field) {
    const positiveWords = ['yes', 'positive', 'present', 'true', 'confirmed', 'detected', 'found'];
    const negativeWords = ['no', 'negative', 'absent', 'false', 'denied', 'not detected', 'not found'];
    
    const textLower = text.toLowerCase();
    const fieldContext = this.getFieldContext(textLower, field.fieldName, 100);
    
    for (const word of positiveWords) {
      if (fieldContext.includes(word)) return true;
    }
    
    for (const word of negativeWords) {
      if (fieldContext.includes(word)) return false;
    }
    
    return null;
  }

  // Get context around field name
  getFieldContext(text, fieldName, contextLength = 100) {
    const searchTerms = [
      fieldName.toLowerCase(),
      fieldName.replace(/_/g, ' ').toLowerCase()
    ];

    for (const term of searchTerms) {
      const index = text.indexOf(term);
      if (index !== -1) {
        const start = Math.max(0, index - contextLength);
        const end = Math.min(text.length, index + term.length + contextLength);
        return text.substring(start, end);
      }
    }
    
    return '';
  }

  // Enhanced PDF processing with OCR support
  async processPDF(pdfId, pdfBuffer, userId, pdfPath) {
    try {
      console.log(`Starting PDF processing for ID: ${pdfId}`);
      
      // Update status to processing
      await PDFDocument.findByIdAndUpdate(pdfId, { 
        processingStatus: 'processing' 
      });

      // Extract text (with OCR support)
      const extractedText = await this.extractText(pdfBuffer, pdfPath);
      
      if (!extractedText || extractedText.length < 20) {
        throw new Error('Insufficient text extracted from PDF');
      }

      console.log(`Text extracted successfully. Length: ${extractedText.length}`);
      
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
          message: 'No matching disease template found',
          extractedText: extractedText.substring(0, 500) + '...' // Return preview of extracted text
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

      console.log(`PDF processing completed successfully for ${diseaseMatch.template.diseaseName}`);

      return {
        success: true,
        message: 'PDF processed successfully with OCR support',
        medicalRecord,
        disease: diseaseMatch.template.diseaseName,
        confidence: diseaseMatch.confidence,
        keywordMatches: diseaseMatch.keywordMatches,
        extractedDataCount: extractedData.size
      };

    } catch (error) {
      console.error('PDF processing error:', error);
      
      await PDFDocument.findByIdAndUpdate(pdfId, { 
        processingStatus: 'failed' 
      });
      
      throw error;
    }
  }
}

module.exports = new PDFProcessor();