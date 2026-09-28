import json

from PIL import Image

from portraitgen import run


def _candidate(work, card, seed, ok, aesthetic):
    d = work / "candidates" / card
    d.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (run.WIDTH // 8, run.HEIGHT // 8)).save(d / f"{seed}.png")
    report = {"ok": ok, "issues": [] if ok else ["cut off at the bottom"], "aesthetic": aesthetic}
    (d / f"{seed}.json").write_text(json.dumps(report))


def test_best_ranks_accepted_candidates_and_takes_str_paths(tmp_path):
    # The notebook passes its work directory as a plain string.
    _candidate(tmp_path, "bb_guren", 1, True, 0.6)
    _candidate(tmp_path, "bb_guren", 2, True, 0.9)
    _candidate(tmp_path, "bb_guren", 3, False, 0.99)
    work = str(tmp_path)
    assert [seed for seed, _ in run.candidates(work, "bb_guren")] == [2, 1, 3]
    assert run.best(work, "bb_guren") == 2
    assert run.best(work, "nobody") is None
    assert run.candidate_sheet(work, "bb_guren") is not None
