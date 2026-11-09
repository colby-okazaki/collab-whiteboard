import { render, screen, fireEvent } from '@testing-library/react';
import Toolbar from '../components/Toolbar';

test('marks the active tool and reports tool changes', () => {
  const onToolChange = jest.fn();
  render(<Toolbar tool="pen" color="#000000" onToolChange={onToolChange} onColorChange={() => {}} />);

  expect(screen.getByRole('button', { name: 'pen' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'eraser' }));
  expect(onToolChange).toHaveBeenCalledWith('eraser');
});

test('clear board button calls onClear', () => {
  const onClear = jest.fn();
  render(<Toolbar tool="pen" color="#000000" onToolChange={() => {}} onColorChange={() => {}} onClear={onClear} />);
  fireEvent.click(screen.getByRole('button', { name: 'clear board' }));
  expect(onClear).toHaveBeenCalledTimes(1);
});

test('changing the color reports the new color', () => {
  const onColorChange = jest.fn();
  render(<Toolbar tool="pen" color="#000000" onToolChange={() => {}} onColorChange={onColorChange} onClear={() => {}} />);
  fireEvent.change(screen.getByLabelText('Pen color'), { target: { value: '#ff0000' } });
  expect(onColorChange).toHaveBeenCalledWith('#ff0000');
});
