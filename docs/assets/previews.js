const previews = new ResizeObserver(entries => {
  for (const { target, contentRect } of entries) {
    const frame = target.querySelector('iframe');
    frame.style.transform = `scale(${contentRect.width / Number(frame.width)})`;
  }
});

document.querySelectorAll('.preview-stage').forEach(stage => previews.observe(stage));
