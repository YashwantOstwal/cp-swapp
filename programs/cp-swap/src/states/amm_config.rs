use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace,Debug)]
pub struct AmmConfig {
    pub disable_create_pool:bool,
    pub swap_fee_rate_in_bps:u16,
    pub update_authority:Option<Pubkey>,
}

impl AmmConfig {
    pub const LEN:usize = 8 + AmmConfig::INIT_SPACE;
}