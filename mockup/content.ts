export type Doc = { title: string; html: string };

export const docs = {
      host: {
        title: "Delta hedging",
        html: `
          <p>Consider a portfolio</p>
          <div class="eq">\\[\\Pi = V(S,t) - \\Delta S\\]</div>
          <div class="walk">
            lognormal random walk
            <svg viewBox="0 0 160 72" aria-hidden="true">
              <polyline fill="none" stroke="#2563eb" stroke-width="1.6"
                points="4,58 18,50 28,54 40,42 52,46 64,30 78,36 92,22 108,28 122,16 138,20 156,10" />
              <text x="8" y="12" font-size="9" fill="#6b7280">S</text>
              <text x="118" y="68" font-size="9" fill="#6b7280">Time</text>
            </svg>
          </div>
          <p>The underlying follows a
            <mark class="rivet" data-to="gbm">lognormal random walk</mark>
            \\(dS = \\mu S\\,dt + \\sigma S\\,dX\\).</p>
          <p>From \\(t\\) to \\(t+dt\\),</p>
          <div class="eq">\\[d\\Pi = dV - \\Delta\\, dS\\]</div>
          <p><mark class="rivet" data-to="ito">By Itô's Lemma</mark>,</p>
          <div class="eq">\\[dV = \\frac{\\partial V}{\\partial t}\\,dt + \\frac{\\partial V}{\\partial S}\\,dS + \\frac12 \\sigma^2 S^2 \\frac{\\partial^2 V}{\\partial S^2}\\,dt\\]</div>
          <p>so</p>
          <div class="eq">\\[d\\Pi = \\Bigl(\\frac{\\partial V}{\\partial t} + \\frac12 \\sigma^2 S^2 \\frac{\\partial^2 V}{\\partial S^2}\\Bigr)dt + \\Bigl(\\frac{\\partial V}{\\partial S} - \\Delta\\Bigr)dS\\]</div>
          <p>deterministic terms, then random terms. If we choose
            <mark class="rivet" data-to="delta">\\(\\Delta = \\partial V/\\partial S\\)</mark>,
            then no randomness.</p>
          <p>Any reduction in randomness is generally termed
            <mark class="rivet" data-to="hedging">hedging</mark>.</p>
          <p>The perfect elimination of risk by exploiting
            <mark class="rivet" data-to="two">the correlation between two instruments</mark>
            is called delta hedging.</p>
          <p>Delta hedging belongs to a
            <mark class="rivet" data-to="dynamic">dynamic hedging</mark>
            strategy, in comparison with static hedging.</p>
          <p>After the hedge, the portfolio increment is deterministic. We still owe an account a return:
            the claim
            <mark class="rivet" data-to="arb">\\(d\\Pi = r\\Pi\\,dt\\)</mark>.</p>
          <p class="src">source / notes · 手稿 1 为宿主；手稿 2 挂在最后这个铆点上。</p>
        `
      },
      gbm: {
        title: "Lognormal random walk",
        html: `
          <p>The SDE \\(dS = \\mu S\\,dt + \\sigma S\\,dX\\) is geometric Brownian motion:
          returns are independent of the price level, so \\(S\\) stays positive.</p>
          <p>\\(dX\\) is a
            <mark class="rivet" data-to="wx">Wiener increment</mark>
            (Brownian motion): mean zero, variance \\(dt\\), and
            \\((dX)^2 = dt\\) in the Itô calculus.</p>
          <p class="note">演示：这一列仍是完整宿主，可以再划。</p>
        `
      },
      wx: {
        title: "Brownian motion",
        html: `
          <p>\\(X_t\\) is standard Brownian motion: continuous paths, independent Gaussian increments
          \\(X_{t+dt}-X_t \\sim \\mathcal N(0,dt)\\).</p>
          <p>This is as far as the demo chain goes. A real note would stop or link out to a textbook chapter.</p>
        `
      },
      ito: {
        title: "Itô's Lemma",
        html: `
          <p>If \\(V=V(S,t)\\) and \\(S\\) has diffusion \\(\\sigma S\\), the chain rule picks up a second-order term from
          \\((dS)^2\\):</p>
          <div class="eq">\\[dV = V_t\\,dt + V_S\\,dS + \\tfrac12 V_{SS}(dS)^2\\]</div>
          <p>and \\((dS)^2 = \\sigma^2 S^2\\,dt\\) after dropping \\((dt)^2\\) and \\(dt\\,dX\\).</p>
          <p><mark class="rivet" data-to="ito-proof">Proof of Itô's Lemma</mark> — 手稿上写的是 link to another file / view。</p>
          <p>The extra \\(\\tfrac12 \\sigma^2 S^2 V_{SS}\\,dt\\) is why a delta-hedged option is not just
          \\(V_t\\,dt\\): convexity (gamma) still earns or costs drift.</p>
        `
      },
      "ito-proof": {
        title: "Proof of Itô's Lemma",
        html: `
          <p class="note">占位。真页面会是另一篇宿主（Taylor + 二次变差），不是这里写完的证明。</p>
          <p>Taylor expand \\(V(S+dS, t+dt)\\), keep terms of order \\(dt\\), replace \\((dS)^2\\) by its quadratic variation.</p>
        `
      },
      delta: {
        title: "The hedge ratio",
        html: `
          <p>The coefficient of the random \\(dS\\) in \\(d\\Pi\\) is \\(V_S - \\Delta\\). Setting
          \\(\\Delta = V_S\\) cancels it.</p>
          <p>\\(\\Delta\\) is the number of units of the underlying held short against the option.
          It must be refreshed as \\(S\\) and \\(t\\) move — that is why this is dynamic.</p>
        `
      },
      hedging: {
        title: "Hedging",
        html: `
          <p>Hedging: any reduction in randomness. It need not be perfect.</p>
          <p>Delta hedging is the special case that aims to cancel the first-order exposure to \\(S\\).</p>
        `
      },
      two: {
        title: "Two instruments",
        html: `
          <p>In this derivation the two instruments are <em>an option and its underlying</em>.</p>
          <p>Correlation here is not a statistical estimate: both are functions of the same \\(S\\),
          so their infinitesimal moves share the \\(dS\\) term.</p>
        `
      },
      dynamic: {
        title: "Dynamic vs static",
        html: `
          <p>Static: put on a hedge and leave it. Dynamic: rebalance \\(\\Delta\\) as the greeks change.</p>
          <p>A one-time stock holding cannot keep \\(V_S - \\Delta = 0\\) for all later \\(S\\).</p>
        `
      },
      arb: {
        title: "No-arbitrage: \\(d\\Pi = r\\Pi\\,dt\\)",
        html: `
          <p>After choosing \\(\\Delta = V_S\\),</p>
          <div class="eq">\\[d\\Pi = \\Bigl(\\frac{\\partial V}{\\partial t} + \\tfrac12 \\sigma^2 S^2 \\frac{\\partial^2 V}{\\partial S^2}\\Bigr)dt\\]</div>
          <p><strong>Claim.</strong> \\(d\\Pi = r\\Pi\\,dt\\): the risk-free change in \\(\\Pi\\) equals the growth
          from a risk-free interest-bearing account.</p>
          <p>Exploiting an arbitrage opportunity will cause the price of the option to move in the
          direction that eliminates the arbitrage.</p>
          <div class="case">
            <h4><mark class="rivet" data-to="case1">Case 1: \\(d\\Pi &gt; r\\Pi\\,dt\\)</mark></h4>
            <p>Portfolio grows faster than the bank. Borrow \\(\\Pi\\), hold the delta-hedged book.</p>
          </div>
          <div class="case">
            <h4><mark class="rivet" data-to="case2">Case 2: \\(d\\Pi &lt; r\\Pi\\,dt\\)</mark></h4>
            <p>Short the option and delta-hedge: \\(-\\Pi = -V + \\Delta S\\). Put the cash in the bank.</p>
          </div>
        `
      },
      case1: {
        title: "Case 1 · long the book",
        html: `
          <p>Borrow \\(\\Pi\\) from the bank. Make a portfolio of value \\(\\Pi\\) by delta hedging.</p>
          <p>At the end of the day:</p>
          <div class="eq">\\[\\text{profit} = (\\Pi + d\\Pi) - (r\\Pi\\,dt + \\Pi) = d\\Pi - r\\Pi\\,dt &gt; 0\\]</div>
          <p>No net initial capital, guaranteed profit — arbitrage. Option prices must move until this cannot happen.</p>
        `
      },
      case2: {
        title: "Case 2 · short the book",
        html: `
          <p>Short the option and delta hedge. The book is \\(-\\Pi = -V + \\Delta S\\).</p>
          <p>So \\(\\Pi\\) is borrowed and put in the bank.</p>
          <p>At the end of the day:</p>
          <div class="eq">\\[\\text{profit} = (\\Pi + r\\Pi\\,dt) - (\\Pi + d\\Pi) = r\\Pi\\,dt - d\\Pi &gt; 0\\]</div>
          <p>\\(\\Pi + r\\Pi\\,dt\\) is money from the bank;
          \\(\\Pi + d\\Pi\\) is used to close the position.</p>
        `
      }
    };

export type DocId = keyof typeof docs;

export const pinPresets: Partial<Record<DocId, { label: string; html: string }>> = {
      host: { label: "Π = V − ΔS", html: "\\(\\Pi = V(S,t) - \\Delta S\\)" },
      delta: { label: "Δ = ∂V/∂S", html: "\\(\\Delta = \\partial V/\\partial S\\)" },
      arb: { label: "dΠ = rΠ dt", html: "\\(d\\Pi = r\\Pi\\,dt\\)" }
    };

