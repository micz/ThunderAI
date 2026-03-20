import { taLogger } from '../js/mzta-logger.js';

describe('taLogger', () => {
  let logSpy, errorSpy, warnSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets prefix and debug flag in constructor', () => {
    const logger = new taLogger('Test', true);
    expect(logger.prefix).toBe('[ThunderAI Logger | Test] ');
    expect(logger.do_debug).toBe(true);
  });

  it('log() outputs when debug is true', () => {
    const logger = new taLogger('Test', true);
    logger.log('hello');
    expect(logSpy).toHaveBeenCalledWith('[ThunderAI Logger | Test] hello');
  });

  it('log() is silent when debug is false', () => {
    const logger = new taLogger('Test', false);
    logger.log('hello');
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('log() with do_debug parameter changes debug state', () => {
    const logger = new taLogger('Test', false);
    logger.log('hello', true);
    expect(logSpy).toHaveBeenCalledWith('[ThunderAI Logger | Test] hello');
    expect(logger.do_debug).toBe(true);
  });

  it('error() always outputs regardless of debug flag', () => {
    const logger = new taLogger('Test', false);
    logger.error('something broke');
    expect(errorSpy).toHaveBeenCalledWith('[ThunderAI Logger | Test] something broke');
  });

  it('warn() always outputs regardless of debug flag', () => {
    const logger = new taLogger('Test', false);
    logger.warn('watch out');
    expect(warnSpy).toHaveBeenCalledWith('[ThunderAI Logger | Test] watch out');
  });

  it('changeDebug() updates the debug flag', () => {
    const logger = new taLogger('Test', false);
    expect(logger.do_debug).toBe(false);
    logger.changeDebug(true);
    expect(logger.do_debug).toBe(true);
  });
});
