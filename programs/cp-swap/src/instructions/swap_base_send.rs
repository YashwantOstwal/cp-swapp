use anchor_lang::prelude::*;
use anchor_spl::{token::{Token},token_2022::spl_token_2022::{self, extension::{transfer_fee::TransferFeeConfig, BaseStateWithExtensions, StateWithExtensions}}, token_interface::{Mint, TokenAccount, TokenInterface,transfer_checked,TransferChecked}};

use crate::{error::ErrorCode, states::*, CurveMath};

#[derive(Accounts)]
pub struct SwapBaseSend<'info> {

    pub trader: Signer<'info>,

    pub amm_config: Box<Account<'info,AmmConfig>>,

    #[account(
        has_one = amm_config,
        constraint = (send_mint.key() == pool.mint_0 && receive_mint.key() ==  pool.mint_1) || (send_mint.key() == pool.mint_1 && receive_mint.key() ==  pool.mint_0) @ ErrorCode::MismatchAccounts
    )]
    pub pool: Box<Account<'info,Pool>>,

    #[account(
        mut,
        token::authority = trader,
        token::mint = send_mint,
        token::token_program = send_token_program,
    )]
    pub trader_send_token:Box<InterfaceAccount<'info,TokenAccount>>,

    #[account(
        mut,
        associated_token::authority = pool,
        associated_token::mint = send_mint,
        associated_token::token_program = send_token_program,
    )]
    pub send_token_vault:Box<InterfaceAccount<'info,TokenAccount>>,

    #[account(
        mint::token_program = send_token_program
    )]
    pub send_mint:Box<InterfaceAccount<'info,Mint>>,
    pub send_token_program:Interface<'info,TokenInterface>,

    #[account(
        mut,
        token::authority = trader,
        token::mint = receive_mint,
        token::token_program = receive_token_program,
    )]
    pub trader_receive_token:Box<InterfaceAccount<'info,TokenAccount>>,

    #[account(
        mut,
        associated_token::authority = pool,
        associated_token::mint = receive_mint,
        associated_token::token_program = receive_token_program,
    )]
    pub receive_token_vault:Box<InterfaceAccount<'info,TokenAccount>>,

    #[account(
        mint::token_program = receive_token_program
    )]
    pub receive_mint:Box<InterfaceAccount<'info,Mint>>,
    pub receive_token_program:Interface<'info,TokenInterface>,
}

pub fn handle_swap_base_send(ctx:Context<SwapBaseSend>,exact_amount_user_send:u64,min_amount_user_receive:u64) -> Result<()> {

    let trader_send_token = &ctx.accounts.trader_send_token;
    require!(exact_amount_user_send <= trader_send_token.amount ,ErrorCode::InsufficientFunds);

    let send_mint = &ctx.accounts.send_mint;
    let exact_amount_pool_receive = if ctx.accounts.send_token_program.key() == Token::id() {
        exact_amount_user_send
    }else {
        let send_mint_info = send_mint.to_account_info();
        let send_mint_data = send_mint_info.try_borrow_data()?;
        let send_mint_state = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&send_mint_data)?;
        if let Ok(transfer_fee_config) = send_mint_state.get_extension::<TransferFeeConfig>() {
            let clock = Clock::get()?;
            let transfer_fee = transfer_fee_config.get_epoch_fee(clock.epoch);
            transfer_fee.calculate_post_fee_amount(exact_amount_user_send).unwrap()
        }else {
            exact_amount_user_send
        }
    };

    msg!("exact_amount_pool_receive: {}",exact_amount_pool_receive);
    let amm_config = &ctx.accounts.amm_config;
    let curve_send_amount = if !amm_config.is_fee_side_receive {
        amm_config.calculate_post_fee_amount(exact_amount_pool_receive)
    }else {
        exact_amount_pool_receive
    };
    msg!("curve_send_amount: {}",curve_send_amount);

    let x = ctx.accounts.send_token_vault.amount;
    let y = ctx.accounts.receive_token_vault.amount;
    let k = CurveMath::calculate_k(x, y);
    msg!("k: {}",k);

    let curve_output_amount = CurveMath::calculate_curve_output_amount(x, y, x.checked_add(curve_send_amount).unwrap());
    msg!("curve_output_amount: {}",curve_output_amount); 

    let exact_amount_pool_send = if amm_config.is_fee_side_receive {
        amm_config.calculate_post_fee_amount(curve_output_amount)
    }else {
        curve_output_amount
    };
    msg!("exact_amount_pool_send: {}",exact_amount_pool_send);

    let receive_mint = &ctx.accounts.receive_mint;
    let exact_amount_user_receive = if ctx.accounts.receive_token_program.key() == Token::id() {
        exact_amount_pool_send
    }else {
        let receive_mint_info = receive_mint.to_account_info();
        let receive_mint_data = receive_mint_info.try_borrow_data()?;
        let receive_mint_state = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&receive_mint_data)?;
        if let Ok(transfer_fee_config) = receive_mint_state.get_extension::<TransferFeeConfig>() {
            let clock = Clock::get()?;
            let transfer_fee = transfer_fee_config.get_epoch_fee(clock.epoch);
            transfer_fee.calculate_post_fee_amount(exact_amount_pool_send).unwrap()
        }else {
            exact_amount_pool_send
        }
    };
    
    require!(exact_amount_user_receive >= min_amount_user_receive,ErrorCode::NotMinimumReceiveAmount);
    msg!("exact_amount_user_receive: {}",exact_amount_user_receive);

    let user_send_ctx = CpiContext::new(ctx.accounts.send_token_program.key(),TransferChecked {
        mint:send_mint.to_account_info(),
        from:ctx.accounts.trader_send_token.to_account_info(),
        to:ctx.accounts.send_token_vault.to_account_info(),
        authority:ctx.accounts.trader.to_account_info(),
    });

    transfer_checked(user_send_ctx,exact_amount_user_send, ctx.accounts.send_mint.decimals)?;

    let amm_config_key = ctx.accounts.amm_config.key();

    let pool = &ctx.accounts.pool;

    let pool_seeds:&[&[u8]] = &[Pool::STATIC_SEED,amm_config_key.as_ref(),pool.mint_0.as_ref(),pool.mint_1.as_ref(),&[pool.bump]];
    let signer_seeds = [&pool_seeds[..]];

    let user_receive_ctx = CpiContext::new(ctx.accounts.receive_token_program.key(),TransferChecked {
        mint:receive_mint.to_account_info(),
        from:ctx.accounts.receive_token_vault.to_account_info(),
        to:ctx.accounts.trader_receive_token.to_account_info(),
        authority:ctx.accounts.pool.to_account_info(),
    }).with_signer(&signer_seeds);

    transfer_checked(user_receive_ctx,exact_amount_pool_send, ctx.accounts.receive_mint.decimals)?;

    ctx.accounts.send_token_vault.reload()?;
    ctx.accounts.receive_token_vault.reload()?;

    let new_x = ctx.accounts.send_token_vault.amount;
    let new_y = ctx.accounts.receive_token_vault.amount;
    let new_k = CurveMath::calculate_k(new_x, new_y);

    msg!("new_k: {}",new_k);

    require!(k <= new_k,ErrorCode::ConstantProductInvariantFailed);
    Ok(())
}
