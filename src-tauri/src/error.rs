use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("vault is locked")]
    VaultLocked,

    #[error("invalid password")]
    InvalidPassword,

    #[error("vault file not found: {0}")]
    VaultNotFound(String),

    #[error("vault file already exists: {0}")]
    VaultAlreadyExists(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("invalid input: {0}")]
    Invalid(String),

    #[error("internal: {0}")]
    Internal(String),
}

impl From<anyhow::Error> for AppError {
    fn from(value: anyhow::Error) -> Self {
        AppError::Internal(value.to_string())
    }
}

#[derive(Serialize)]
struct SerializedError<'a> {
    code: &'a str,
    message: String,
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let code = match self {
            AppError::VaultLocked => "vault_locked",
            AppError::InvalidPassword => "invalid_password",
            AppError::VaultNotFound(_) => "vault_not_found",
            AppError::VaultAlreadyExists(_) => "vault_already_exists",
            AppError::Io(_) => "io",
            AppError::Db(_) => "db",
            AppError::Invalid(_) => "invalid",
            AppError::Internal(_) => "internal",
        };
        SerializedError {
            code,
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}

pub type AppResult<T> = Result<T, AppError>;
