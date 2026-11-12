import { exportBoardPng } from '../utils/exportBoard';

const setup = (overrides = {}) => {
  const calls = [];
  const stage = { toDataURL: jest.fn(() => (calls.push('capture'), 'data:image/png;base64,AAAA')) };
  const cursorLayer = { hide: jest.fn(() => calls.push('hide')), show: jest.fn(() => calls.push('show')) };
  const link = { click: jest.fn(), remove: jest.fn() };
  const doc = { createElement: jest.fn(() => link), body: { appendChild: jest.fn() } };
  return { calls, stage, cursorLayer, link, doc, args: { stage, cursorLayer, boardId: 'team-sync', doc, ...overrides } };
};

test('downloads the image under a name that includes the board', () => {
  const { args, link, doc } = setup();
  exportBoardPng(args);
  expect(doc.createElement).toHaveBeenCalledWith('a');
  expect(link.href).toBe('data:image/png;base64,AAAA');
  expect(link.download).toBe('whiteboard-team-sync.png');
  expect(link.click).toHaveBeenCalledTimes(1);
  expect(link.remove).toHaveBeenCalledTimes(1);
});

test('captures a PNG at twice the screen resolution', () => {
  const { args, stage } = setup();
  exportBoardPng(args);
  expect(stage.toDataURL).toHaveBeenCalledWith({ mimeType: 'image/png', pixelRatio: 2 });
});

test('hides the cursors only while capturing', () => {
  const { args, calls } = setup();
  exportBoardPng(args);
  expect(calls).toEqual(['hide', 'capture', 'show']);
});

test('shows the cursors again and downloads nothing if the capture fails', () => {
  const { args, stage, cursorLayer, link } = setup();
  stage.toDataURL.mockImplementation(() => {
    throw new Error('canvas too large');
  });
  expect(() => exportBoardPng(args)).toThrow('canvas too large');
  expect(cursorLayer.show).toHaveBeenCalledTimes(1);
  expect(link.click).not.toHaveBeenCalled();
});

test('works without a cursor layer', () => {
  const { args, link } = setup({ cursorLayer: null });
  exportBoardPng(args);
  expect(link.click).toHaveBeenCalledTimes(1);
});
