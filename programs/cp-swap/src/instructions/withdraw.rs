use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token::Token, token_2022::{spl_token_2022::{self, extension::{transfer_fee::TransferFeeConfig, BaseStateWithExtensions, StateWithExtensions}}, Token2022}, token_interface::{Mint, TokenAccount, TokenInterface,transfer_checked,TransferChecked,burn_checked,BurnChecked}   };
use crate::{constants::*,states::*,error::ErrorCode};
#[derive(Accounts)]
pub struct Withdraw<'info> {

    pub lp: Signer<'info>,

    #[account(
        mint::token_program = token_0_program
    )]
    pub mint_0: Box<InterfaceAccount<'info,Mint>>,
    pub token_0_program: Interface<'info,TokenInterface>,

    #[account(
        mut,
        token::mint = mint_0,
        token::authority = lp,
        token::token_program = token_0_program,
    )]
    pub lp_token_0: Box<InterfaceAccount<'info,TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = mint_0,
        associated_token::authority = pool,
        associated_token::token_program = token_0_program,
    )]
    pub token_0_vault: Box<InterfaceAccount<'info,TokenAccount>>,

    #[account(
        mint::token_program = token_1_program,
        constraint = mint_0.key() < mint_1.key() @ ErrorCode::Mint1LexicographicallyGreaterThanOrEqualToMint0
    )]
    pub mint_1: Box<InterfaceAccount<'info,Mint>>,
    pub token_1_program: Interface<'info,TokenInterface>,

    #[account(
        mut,
        token::mint = mint_1,
        token::authority = lp,
        token::token_program = token_1_program,
    )]
    pub lp_token_1: Box<InterfaceAccount<'info,TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = mint_1,
        associated_token::authority = pool,
        associated_token::token_program = token_1_program
    )]
    pub token_1_vault: Box<InterfaceAccount<'info,TokenAccount>>,
    
    #[account(
        mut, // pool.lp_supply is about to change.
        has_one = amm_config,
        has_one = mint_0,
        has_one = mint_1,
        seeds = [Pool::STATIC_SEED,amm_config.key().as_ref(),mint_0.key().as_ref(),mint_1.key().as_ref(),],
        bump = pool.bump
    )]
    pub pool: Box<Account<'info,Pool>>,

    pub amm_config : Box<Account<'info,AmmConfig>>,

    #[account(
        mut, // supply field of this mint is about to change.
        seeds = [LP_MINT_STATIC_SEED,pool.key().as_ref()],
        bump = pool.lp_mint_bump,
        mint::authority = pool,
        mint::token_program = token_2022_program
    )]
    pub lp_mint: Box<InterfaceAccount<'info,Mint>>,

    #[account(
        mut,
        associated_token::mint = lp_mint,
        associated_token::authority = lp,
        associated_token::token_program = token_2022_program,
    )]
    pub lp_token_ata: Box<InterfaceAccount<'info,TokenAccount>>,
    pub token_2022_program: Program<'info,Token2022>,
    
}

pub fn handle_withdraw(ctx:Context<Withdraw>,min_amount_0_lp_receive:u64,min_amount_1_lp_receive:u64,dilute_lp_tokens:u64) -> Result<()> {

    let lp_token = &ctx.accounts.lp_token_ata;
    require!(dilute_lp_tokens > 0 && dilute_lp_tokens <= lp_token.amount,ErrorCode::InvalidAmount);

    let pool = &mut ctx.accounts.pool;
    
    let pool_seeds:&[&[u8]] = &[Pool::STATIC_SEED,pool.amm_config.as_ref(),pool.mint_0.as_ref(),pool.mint_1.as_ref(),&[pool.bump]];
    let signer_seeds  = [&pool_seeds[..]];
    
    let exact_amount_0_pool_must_send = dilute_lp_tokens.checked_mul(ctx.accounts.token_0_vault.amount).unwrap().checked_div(pool.lp_supply).unwrap();

    let mint_0 = &ctx.accounts.mint_0;
    let mint_0_info = mint_0.to_account_info();
    let exact_amount_0_lp_receive = if *mint_0_info.owner == Token::id() {
        exact_amount_0_pool_must_send
    }else {
        let mint_0_data = mint_0_info.try_borrow_data()?;
        let mint_0_state = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&mint_0_data)?;
        if let Ok(transfer_fee_config) = mint_0_state.get_extension::<TransferFeeConfig>() {
            let clock = Clock::get()?;
            let transfer_fee = transfer_fee_config.get_epoch_fee(clock.epoch);
            transfer_fee.calculate_post_fee_amount(exact_amount_0_pool_must_send).unwrap()
        }else {
            exact_amount_0_pool_must_send
        }
    };
    require!(min_amount_0_lp_receive <= exact_amount_0_lp_receive,ErrorCode::NotMinimumReceiveAmount);

    let exact_amount_1_pool_must_send = dilute_lp_tokens.checked_mul(ctx.accounts.token_1_vault.amount).unwrap().checked_div(pool.lp_supply).unwrap();

    let mint_1 = &ctx.accounts.mint_1;
    let mint_1_info = mint_1.to_account_info();
    let exact_amount_1_lp_receive = if *mint_1_info.owner == Token::id() {
        exact_amount_1_pool_must_send
    }else {
        let mint_1_data = mint_1_info.try_borrow_data()?;
        let mint_1_state = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&mint_1_data)?;
        if let Ok(transfer_fee_config) = mint_1_state.get_extension::<TransferFeeConfig>() {
            let clock = Clock::get()?;
            let transfer_fee = transfer_fee_config.get_epoch_fee(clock.epoch);
            transfer_fee.calculate_post_fee_amount(exact_amount_1_pool_must_send).unwrap()
        }else {
            exact_amount_1_pool_must_send
        }
    };
    require!(min_amount_1_lp_receive <= exact_amount_1_lp_receive ,ErrorCode::NotMinimumReceiveAmount);

    let transfer_0_ctx = CpiContext::new(ctx.accounts.token_0_program.key(),TransferChecked {
        mint:mint_0_info,
        from:ctx.accounts.token_0_vault.to_account_info(),
        to:ctx.accounts.lp_token_0.to_account_info(),
        authority:pool.to_account_info(),
    }).with_signer(&signer_seeds);

    transfer_checked(transfer_0_ctx, exact_amount_0_pool_must_send, mint_0.decimals)?;

    let transfer_1_ctx = CpiContext::new(ctx.accounts.token_1_program.key(),TransferChecked {
        mint:mint_1_info,
        from:ctx.accounts.token_1_vault.to_account_info(),
        to:ctx.accounts.lp_token_1.to_account_info(),
        authority:pool.to_account_info(),
    }).with_signer(&signer_seeds);

    transfer_checked(transfer_1_ctx, exact_amount_1_pool_must_send, mint_1.decimals)?;

    let burn_lp_tokens_ctx = CpiContext::new(ctx.accounts.token_2022_program.key(),BurnChecked {
        mint:ctx.accounts.lp_mint.to_account_info(),
        from:ctx.accounts.lp_token_ata.to_account_info(),
        authority:ctx.accounts.lp.to_account_info(),
    });

    burn_checked(burn_lp_tokens_ctx, dilute_lp_tokens, ctx.accounts.lp_mint.decimals)?;

    pool.lp_supply = pool.lp_supply.checked_sub(dilute_lp_tokens).unwrap();
    Ok(())
}