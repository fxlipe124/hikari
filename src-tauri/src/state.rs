use std::sync::Mutex;

use crate::vault::Vault;

#[derive(Default)]
pub struct AppState {
    pub vault: Mutex<Option<Vault>>,
}

impl AppState {
    pub fn new() -> Self {
        Self::default()
    }
}
