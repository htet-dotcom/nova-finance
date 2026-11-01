import { describe, expect, it } from 'vitest';
import { evaluate, isExpression, parseAmountExpr } from '../../src/lib/calc';
import { parseAmount } from '../../src/lib/currency';

const val = (s: string) => {
  const r = evaluate(s);
  return r.ok ? r.value : r.error;
};

describe('calculator', () => {
  it('does arithmetic with precedence and parentheses', () => {
    expect(val('120+35+18')).toBe(173);
    expect(val('2+3*4')).toBe(14);
    expect(val('(2+3)*4')).toBe(20);
    expect(val('100/8')).toBe(12.5);
    expect(val('10-2-3')).toBe(5);
    expect(val('-5+2')).toBe(-3);
    expect(val('2*-3')).toBe(-6);
  });

  it('accepts the symbols people type: × ÷ − x, spaces and thousands separators', () => {
    expect(val('3 × 1,200')).toBe(3600);
    expect(val('90 ÷ 3')).toBe(30);
    expect(val('10 − 4')).toBe(6);
    expect(val('4x25')).toBe(100);
    expect(val('1,250.50 + 0.5')).toBe(1251);
  });

  it('hides floating point noise', () => {
    expect(val('0.1+0.2')).toBe(0.3);
    expect(val('1.15*100')).toBe(115);
  });

  it('percent works like a phone calculator', () => {
    expect(val('200+10%')).toBe(220);
    expect(val('200-10%')).toBe(180);
    expect(val('200*10%')).toBe(20);
    expect(val('50%')).toBe(0.5);
    expect(val('1000+7%+3')).toBe(1073);
    expect(val('(100+100)+5%')).toBe(210);
  });

  it('reports errors instead of guessing', () => {
    expect(val('')).toBe('empty');
    expect(val('5/0')).toBe('divide-by-zero');
    expect(val('5/(2-2)')).toBe('divide-by-zero');
    expect(val('2+')).toBe('syntax');
    expect(val('(2+3')).toBe('syntax');
    expect(val('2)(')).toBe('syntax');
    expect(val('1..2')).toBe('syntax');
    expect(val('alert(1)')).toBe('syntax');
    expect(val('9'.repeat(20))).toBe('too-large');
    expect(val('('.repeat(80) + '1' + ')'.repeat(80))).toBe('syntax');
  });

  it('amount fields: plain numbers keep the strict parser, expressions are evaluated', () => {
    expect(isExpression('1,250')).toBe(false);
    expect(isExpression('-50')).toBe(false);
    expect(isExpression('50+20')).toBe(true);
    expect(parseAmountExpr('1,250.5', parseAmount)).toBe(1250.5);
    expect(parseAmountExpr('120+35', parseAmount)).toBe(155);
    expect(parseAmountExpr('120+', parseAmount)).toBeNull();
    expect(parseAmountExpr('abc', parseAmount)).toBeNull();
  });
});
