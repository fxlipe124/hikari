use std::path::Path;

use crate::error::{AppError, AppResult};

/// Read a PDF file from disk and extract plain text. If `password` is provided,
/// it is used to decrypt the document first.
pub fn extract_text(path: &Path, password: Option<&str>) -> AppResult<String> {
    let bytes = std::fs::read(path)?;
    extract_text_from_bytes(&bytes, password)
}

pub fn extract_text_from_bytes(bytes: &[u8], password: Option<&str>) -> AppResult<String> {
    let mut doc = lopdf::Document::load_mem(bytes)
        .map_err(|e| AppError::Invalid(format!("failed to load PDF: {}", e)))?;

    if doc.is_encrypted() {
        let pw = password.ok_or_else(|| AppError::Invalid("PDF is encrypted; password required".into()))?;
        doc.decrypt(pw)
            .map_err(|_| AppError::InvalidPassword)?;
    }

    // Re-serialize the (now decrypted) document and pass to pdf-extract for text.
    let mut buf: Vec<u8> = Vec::new();
    doc.save_to(&mut buf)
        .map_err(|e| AppError::Internal(format!("failed to re-serialize PDF: {}", e)))?;

    pdf_extract::extract_text_from_mem(&buf)
        .map_err(|e| AppError::Internal(format!("text extraction failed: {}", e)))
}
